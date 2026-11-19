// The Excel copy of the database (checkouts.xlsx in the program's folder), for anyone who wants to
// look at the records without this program.
//
// Every save rebuilds the "Daily Checkouts" and "Master Log" sheets from the whole database, so a
// save that fails loses nothing: the next one that works brings the file fully up to date. Any
// other sheets people add to the workbook are kept (but ExcelJS can't keep charts or pivot
// tables, so those belong in a separate workbook that links to this one).

import ExcelJS from 'exceljs';
import { readFile, rename } from 'node:fs/promises';
import { DAILY_COLUMNS, MASTER_LOG_COLUMNS } from './database.js';
import { writeFileAtomic } from './files.js';

const SHEETS = [
  { name: 'Daily Checkouts', columns: DAILY_COLUMNS, rows: (data) => data.daily },
  { name: 'Master Log', columns: MASTER_LOG_COLUMNS, rows: (data) => data.history },
];
const TIME_COLUMNS = new Set(['checkout', 'returned_at']);
const TIME_FORMAT = 'yyyy-mm-dd h:mm AM/PM';

// Excel has no time zones and shows a date exactly as stored, and ExcelJS stores a Date's UTC
// time. Shifting by this computer's UTC offset makes Excel show local time.
function excelTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso; // not a timestamp: keep the text as it is
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
}

// Replaces the two record sheets in `workbook` with the current data.
export function fillWorkbook(workbook, data) {
  for (const sheet of SHEETS) {
    const old = workbook.getWorksheet(sheet.name);
    if (old) workbook.removeWorksheet(old.id);
    const ws = workbook.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    if (old) ws.orderNo = old.orderNo; // same tab position as before
    ws.columns = sheet.columns.map((key) => TIME_COLUMNS.has(key)
      ? { header: key, key, width: 22, style: { numFmt: TIME_FORMAT } }
      : { header: key, key, width: 24 });
    ws.getRow(1).font = { bold: true };
    for (const row of sheet.rows(data)) {
      ws.addRow(Object.fromEntries(sheet.columns.map((key) => [key, TIME_COLUMNS.has(key) ? excelTime(row[key]) : row[key]])));
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
}

// The existing workbook, or a new one if there isn't one yet. If the file can't be read (no
// permission, or another program has it locked) this throws so the save is tried again later;
// the file is never replaced with one that's missing its other sheets. A file that isn't a
// readable workbook at all is renamed out of the way, so nothing in it is lost, and a new one is
// started.
async function loadWorkbook(path, log) {
  const workbook = new ExcelJS.Workbook();
  let contents;
  try {
    contents = await readFile(path);
  } catch (err) {
    if (err.code === 'ENOENT') return workbook;
    throw err;
  }
  try {
    await workbook.xlsx.load(contents);
    return workbook;
  } catch (err) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const aside = `${path.replace(/\.xlsx$/i, '')}-unreadable-${stamp}.xlsx`;
    await rename(path, aside);
    log.warn(`${path} could not be opened as a workbook (${err.message}). It was renamed to ${aside} and a new one was started.`);
    return new ExcelJS.Workbook();
  }
}

// Brings the Excel file at `path` up to date with `data` ({ daily, history } rows).
export async function saveExcelFile(path, data, log = console) {
  const workbook = await loadWorkbook(path, log);
  fillWorkbook(workbook, data);
  await writeFileAtomic(path, await workbook.xlsx.writeBuffer());
}

// A workbook with just the two record sheets, for "Download Excel" on the admin page.
export async function excelDownload(data) {
  const workbook = new ExcelJS.Workbook();
  fillWorkbook(workbook, data);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
