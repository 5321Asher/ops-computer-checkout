// Checking items out and back in through the API, as the pages do.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { startApp } from './helpers.js';

test('checking out stores the item and lists it as checked out', async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const res = await app.post('/api/checkouts', { name: '  Jane   Doe ', asset: 'OPS-1234', location: 'Courtroom 3' });
  assert.equal(res.status, 201);
  const { message, item } = await res.json();
  assert.equal(message, 'OPS-1234 checked out successfully.');
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.ok(Math.abs(new Date(item.checkout) - Date.now()) < 5000);

  const out = await (await app.get('/api/checkouts')).json();
  assert.deepEqual(out.map(({ name, asset, location }) => ({ name, asset, location })),
    [{ name: 'Jane Doe', asset: 'OPS-1234', location: 'Courtroom 3' }]);
});

test('any asset is accepted, tidied: upper case, and a CSD suffix removed', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const cases = {
    'ops-1234': 'OPS-1234',
    'rsi-77': 'RSI-77',
    'Ops-12': 'OPS-12',
    'OPS-1234CSD': 'OPS-1234',
    'ops-1234 csd': 'OPS-1234',
    'OPS-1234-CSD': 'OPS-1234',
    '  RSI-9  ': 'RSI-9',
    'LAPTOP-1': 'LAPTOP-1',
    'Projector  2': 'PROJECTOR 2',
    '12345': '12345',
    'OPS-': 'OPS-',
  };
  for (const [typed, stored] of Object.entries(cases)) {
    assert.equal((await app.checkOut({ asset: typed })).asset, stored, typed);
  }
});

test('checkouts with missing or wrong details are refused', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const refused = async (details, message) => {
    const res = await app.post('/api/checkouts', { name: 'Jane', asset: 'OPS-1', location: 'Room', ...details });
    assert.equal(res.status, 400, JSON.stringify(details));
    assert.match((await res.json()).error, message);
  };
  await refused({ name: '' }, /fill out all fields/);
  await refused({ name: '   ' }, /fill out all fields/);
  await refused({ location: undefined }, /fill out all fields/);
  await refused({ asset: 42 }, /fill out all fields/);
  await refused({ asset: '  ' }, /fill out all fields/);
  await refused({ name: 'x'.repeat(101) }, /Customer must be 100 characters or fewer/);
  await refused({ asset: 'x'.repeat(101) }, /Asset must be 100 characters or fewer/);
  assert.deepEqual(await (await app.get('/api/checkouts')).json(), []);

  const bad = await fetch(`${app.base}/api/checkouts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
});

test('returning an item moves it to the history and adds a ticket', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const item = await app.checkOut({ name: 'Jane Doe', asset: 'RSI-42', location: 'Courtroom 3' });

  const res = await app.post(`/api/checkouts/${item.id}/return`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, 'RSI-42 returned successfully.');
  assert.deepEqual(await (await app.get('/api/checkouts')).json(), []);

  const [logged] = await (await app.get('/api/history')).json();
  assert.equal(logged.id, item.id);
  assert.equal(logged.checkout, item.checkout);
  assert.ok(logged.returned_at >= item.checkout);

  await app.tickets.sendNow();
  const { readFile } = await import('node:fs/promises');
  const tickets = JSON.parse(await readFile(app.ticketListPath, 'utf8'));
  assert.deepEqual(tickets, [{
    asset: 'RSI-42', checkout: item.checkout, return: logged.returned_at, user: 'Jane Doe',
    location: 'Courtroom 3', rso: '', status: 'Returned', id: item.id,
  }]);
});

test('returning an item twice, or one that does not exist, is refused', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const item = await app.checkOut();
  assert.equal((await app.post(`/api/checkouts/${item.id}/return`)).status, 200);
  const again = await app.post(`/api/checkouts/${item.id}/return`);
  assert.equal(again.status, 404);
  assert.match((await again.json()).error, /not checked out/);
  assert.equal((await app.post('/api/checkouts/nope/return')).status, 404);
  assert.equal((await app.post('/api/checkouts/%E0%A4%A/return')).status, 400);
  assert.equal((await (await app.get('/api/history')).json()).length, 1);
  await app.tickets.sendNow();
  const { readFile } = await import('node:fs/promises');
  assert.equal(JSON.parse(await readFile(app.ticketListPath, 'utf8')).length, 1);
});

test('the items out are listed most recently checked out first', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  for (const asset of ['OPS-1', 'OPS-2', 'OPS-3']) await app.checkOut({ asset });
  assert.deepEqual((await (await app.get('/api/checkouts')).json()).map((r) => r.asset), ['OPS-3', 'OPS-2', 'OPS-1']);
});

test('notes can be added to items out and returned, and carry over when an item is returned', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const note = (id, body) => app.post(`/api/checkouts/${id}/note`, body);
  const item = await app.checkOut({ asset: 'OPS-1' });

  const res = await note(item.id, { note: '  charger\n included ' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { message: 'Note saved.', note: 'charger included' });
  assert.equal((await (await app.get('/api/checkouts')).json())[0].note, 'charger included');

  await app.post(`/api/checkouts/${item.id}/return`);
  assert.equal((await (await app.get('/api/history')).json())[0].note, 'charger included');
  await note(item.id, { note: 'screen cracked' });
  assert.equal((await (await app.get('/api/history')).json())[0].note, 'screen cracked');
  assert.deepEqual(await (await note(item.id, { note: '' })).json(), { message: 'Note removed.', note: null });
  assert.equal((await (await app.get('/api/history')).json())[0].note, null);

  assert.equal((await note(item.id, { note: 'x'.repeat(501) })).status, 400);
  assert.equal((await note(item.id, {})).status, 400);
  assert.equal((await note(item.id, { note: 5 })).status, 400);
  assert.equal((await note('nope', { note: 'x' })).status, 404);
  assert.equal((await note('%E0%A4%A', { note: 'x' })).status, 400);
});

test('the history lists the most recently returned first', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  for (const asset of ['OPS-1', 'OPS-2', 'OPS-3']) {
    const item = await app.checkOut({ asset });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await app.post(`/api/checkouts/${item.id}/return`);
  }
  assert.deepEqual((await (await app.get('/api/history')).json()).map((r) => r.asset), ['OPS-3', 'OPS-2', 'OPS-1']);
});

test('Download Excel gives a workbook with both sheets', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const returned = await app.checkOut({ asset: 'OPS-1' });
  await app.post(`/api/checkouts/${returned.id}/return`);
  await app.checkOut({ asset: 'OPS-2' });

  const res = await app.get('/api/export');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="checkouts-\d{4}-\d{2}-\d{2}\.xlsx"/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(workbook.worksheets.map((ws) => ws.name), ['Daily Checkouts', 'Master Log']);
  assert.equal(workbook.getWorksheet('Daily Checkouts').getCell('B2').value, 'OPS-2');
  assert.equal(workbook.getWorksheet('Master Log').getCell('C2').value, 'OPS-1');
});

test('Save Excel writes the Excel file and the status says so', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await app.checkOut();
  const res = await app.post('/api/excel/save');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, `Saved to ${app.excelPath}`);

  const status = await (await app.get('/api/status')).json();
  assert.equal(status.location, 'Test Location');
  assert.equal(status.serverFolder, app.serverFolder);
  assert.equal(status.excel.path, app.excelPath);
  assert.equal(status.excel.lastError, null);
  assert.ok(status.excel.lastSuccessAt);
  assert.equal(status.tickets.waiting, 0);
});
