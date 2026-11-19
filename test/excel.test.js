// The Excel copy: always brought fully up to date, never losing other sheets.

import assert from 'node:assert/strict';
import { chmodSync, readdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { backgroundJob } from '../lib/background.js';
import { quietLog, startApp, tempDir, waitFor } from './helpers.js';

const canChangePermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

async function readWorkbook(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

const rowsOf = (ws) => ws.getSheetValues().slice(1).map((row) => row.slice(1));

test('the Excel file gets both sheets, with headers, rows and local times', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const returned = await app.checkOut({ name: 'Jane Doe', asset: 'OPS-1', location: 'Courtroom 3' });
  await app.post(`/api/checkouts/${returned.id}/return`);
  const out = await app.checkOut({ name: 'Sam Lee', asset: 'RSI-2', location: 'Room 5' });
  await app.excel.runNow();

  const workbook = await readWorkbook(app.excelPath);
  assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Daily Checkouts', 'Master Log']);

  const daily = workbook.getWorksheet('Daily Checkouts');
  const [header, row] = rowsOf(daily);
  assert.deepEqual(header, ['name', 'asset', 'location', 'checkout', 'returned_at', 'note', 'id']);
  assert.deepEqual([row[0], row[1], row[2], row[6]], ['Sam Lee', 'RSI-2', 'Room 5', out.id]);
  // Excel shows a date exactly as stored, so the stored value's UTC fields are the local time.
  const shown = row[3];
  const local = new Date(out.checkout);
  assert.ok(shown instanceof Date);
  assert.deepEqual([shown.getUTCHours(), shown.getUTCMinutes(), shown.getUTCDate()], [local.getHours(), local.getMinutes(), local.getDate()]);
  assert.equal(daily.getCell('D2').numFmt, 'yyyy-mm-dd h:mm AM/PM');
  assert.equal(daily.views[0].state, 'frozen');

  const log = workbook.getWorksheet('Master Log');
  assert.deepEqual(rowsOf(log)[0], ['id', 'name', 'asset', 'location', 'checkout', 'returned_at', 'note']);
  assert.deepEqual(rowsOf(log)[1].slice(0, 4), [returned.id, 'Jane Doe', 'OPS-1', 'Courtroom 3']);
});

test('an empty database still gets sheets with headers', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await app.excel.runNow();
  const workbook = await readWorkbook(app.excelPath);
  assert.equal(workbook.getWorksheet('Master Log').getCell('A1').value, 'id');
  assert.equal(workbook.getWorksheet('Daily Checkouts').rowCount, 1);
});

test("other sheets in the workbook are kept, and the tabs don't move", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Notes').getCell('A1').value = 'keep me';
  workbook.addWorksheet('Daily Checkouts').getCell('A1').value = 'old data';
  workbook.addWorksheet('Summary').getCell('B2').value = { formula: "COUNTA('Master Log'!A:A)-1" };
  workbook.addWorksheet('Master Log');
  await workbook.xlsx.writeFile(app.excelPath);

  await app.checkOut({ asset: 'OPS-9' });
  await app.excel.runNow();
  const saved = await readWorkbook(app.excelPath);
  assert.deepEqual(saved.worksheets.map((ws) => ws.name), ['Notes', 'Daily Checkouts', 'Summary', 'Master Log']);
  assert.equal(saved.getWorksheet('Notes').getCell('A1').value, 'keep me');
  assert.equal(saved.getWorksheet('Summary').getCell('B2').value.formula, "COUNTA('Master Log'!A:A)-1");
  assert.equal(saved.getWorksheet('Daily Checkouts').getCell('B2').value, 'OPS-9');
});

test('a damaged Excel file is kept under another name, and a new one is started', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  writeFileSync(app.excelPath, 'this is not a workbook');
  await app.excel.runNow();

  const damaged = readdirSync(app.home).filter((f) => f.startsWith('checkouts-unreadable-'));
  assert.equal(damaged.length, 1);
  assert.ok((await readWorkbook(app.excelPath)).getWorksheet('Master Log'));
  assert.ok(app.log.lines.some((l) => l.includes('could not be opened as a workbook')));
});

test('an Excel file that cannot be read is never replaced; it is retried until it works', { skip: !canChangePermissions }, async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Notes').getCell('A1').value = 'keep me';
  await workbook.xlsx.writeFile(app.excelPath);
  chmodSync(app.excelPath, 0o000); // like another program refusing access for a while

  await app.checkOut({ asset: 'OPS-5' });
  await assert.rejects(app.excel.runNow(), /EACCES/);
  assert.match((await (await app.get('/api/status')).json()).excel.lastError, /EACCES/);

  chmodSync(app.excelPath, 0o644);
  await waitFor(() => app.excel.status().lastSuccessAt, { message: 'the retry' });
  const saved = await readWorkbook(app.excelPath);
  assert.equal(saved.getWorksheet('Notes').getCell('A1').value, 'keep me');
  assert.equal(saved.getWorksheet('Daily Checkouts').getCell('B2').value, 'OPS-5');
  assert.equal((await (await app.get('/api/status')).json()).excel.lastError, null);
});

test('a save that cannot be written leaves the old file alone and is retried', { skip: !canChangePermissions }, async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await app.checkOut({ asset: 'OPS-1' });
  await app.excel.runNow();
  // Straight into the database, so no save is started before the folder is locked below.
  app.store.checkOut({ name: 'A', asset: 'OPS-2', location: 'B' });
  chmodSync(app.home, 0o555); // the folder can't be written, like Excel holding the file open
  t.after(() => chmodSync(app.home, 0o755));

  await assert.rejects(app.excel.runNow());
  assert.equal((await readWorkbook(app.excelPath)).getWorksheet('Daily Checkouts').rowCount, 2);
  assert.deepEqual(readdirSync(app.home).filter((f) => f.endsWith('.tmp')), []);

  chmodSync(app.home, 0o755);
  await waitFor(() => !app.excel.status().lastError, { message: 'the retry' });
  assert.equal((await readWorkbook(app.excelPath)).getWorksheet('Daily Checkouts').rowCount, 3);
});

test('a background job never runs twice at once, and folds repeated requests into one run', async () => {
  let running = 0;
  let mostAtOnce = 0;
  let runs = 0;
  const job = backgroundJob('test', async () => {
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 30));
    running -= 1;
  }, { log: quietLog() });

  for (let i = 0; i < 10; i++) job.request();
  await waitFor(() => !job.status().pending);
  assert.equal(mostAtOnce, 1);
  assert.equal(runs, 2); // the first run, plus one more for the requests made during it
});

test('Save Excel tries straight away, even while waiting to retry', async () => {
  let fail = true;
  const job = backgroundJob('test', async () => { if (fail) throw new Error('file is open'); },
    { retryDelays: [60_000], log: quietLog() });
  job.request();
  await waitFor(() => job.status().lastError === 'file is open');
  fail = false;
  const started = Date.now();
  await job.runNow();
  assert.ok(Date.now() - started < 1000);
  assert.equal(job.status().lastError, null);
  await job.stop();
});

test('Save Excel pressed during a save that then fails gets a fresh try straight away', async () => {
  let tries = 0;
  let release;
  const job = backgroundJob('test', async () => {
    tries += 1;
    if (tries === 1) {
      await new Promise((resolve) => { release = resolve; });
      throw new Error('file is open');
    }
  }, { retryDelays: [60_000], log: quietLog() });
  job.request();
  await waitFor(() => release);
  const saved = job.runNow(); // pressed while the first try is still going
  release();
  const started = Date.now();
  await saved;
  assert.ok(Date.now() - started < 1000);
  assert.equal(tries, 2);
});

test('stopping during a save that then fails stops straight away, without waiting to retry', async () => {
  let release;
  const job = backgroundJob('test', () => new Promise((resolve, reject) => { release = () => reject(new Error('file is open')); }),
    { retryDelays: [60_000], log: quietLog() });
  job.request();
  await waitFor(() => release);
  const stopped = job.stop(); // the window is closed while the Excel file is being saved
  release();
  const started = Date.now();
  await stopped;
  assert.ok(Date.now() - started < 1000);
});

test('a failing job logs the first failure and then only every 10th, not every retry', async () => {
  const log = quietLog();
  let tries = 0;
  const job = backgroundJob('Excel copy', async () => { tries += 1; throw new Error('file is open'); }, { retryDelays: [1], log });
  job.request();
  await waitFor(() => tries >= 30);
  await job.stop();
  assert.equal(log.lines.length, 1 + Math.floor(tries / 10));
  assert.match(log.lines[0], /^Excel copy: failed \(file is open\)/);
});

test('the times shown in Excel are this computer\'s local time', async () => {
  const { fillWorkbook } = await import('../lib/excel.js');
  const workbook = new ExcelJS.Workbook();
  const iso = '2026-07-01T16:30:00.000Z';
  fillWorkbook(workbook, { daily: [{ name: 'A', asset: 'OPS-1', location: 'B', checkout: iso, returned_at: null, note: null, id: 'x' }], history: [] });
  const shown = workbook.getWorksheet('Daily Checkouts').getCell('D2').value;
  const local = new Date(iso);
  assert.equal(shown.toISOString().slice(0, 16),
    `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`);
  assert.equal(workbook.getWorksheet('Daily Checkouts').getCell('E2').value, null);
});

test('the Excel file is brought up to date with no checkouts needed (e.g. at start-up)', async (t) => {
  const home = tempDir();
  const first = await startApp({ home });
  await first.checkOut({ asset: 'OPS-77' });
  await first.close(); // stopped before the Excel copy could be written
  const second = await startApp({ home });
  t.after(() => second.close());
  second.excel.request();
  await waitFor(() => second.excel.status().lastSuccessAt);
  assert.equal((await readWorkbook(second.excelPath)).getWorksheet('Daily Checkouts').getCell('B2').value, 'OPS-77');
});
