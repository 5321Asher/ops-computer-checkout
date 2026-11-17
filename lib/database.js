// The checkouts database: one SQLite file, checkouts.db, with two tables.
//   daily       items that are checked out right now
//   master_log  every item that has been returned
// Returning an item moves its row from daily to master_log.
//
// The tables must stay exactly as the first version of this program made them, so an existing
// checkouts.db can be copied in and used as it is. Nothing here changes an existing database's
// layout or settings; the tables are only created when the file is brand new.

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Exactly as in the first version's checkouts.db.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS daily (
  name TEXT,
  asset TEXT,
  location TEXT,
  checkout TEXT,
  returned_at TEXT,
  note TEXT,
  id TEXT
);
CREATE TABLE IF NOT EXISTS master_log (
  id TEXT,
  name TEXT,
  asset TEXT,
  location TEXT,
  checkout TEXT,
  returned_at TEXT,
  note TEXT
);
`;

// Column order of each table, also used for the Excel sheets.
// checkout and returned_at are ISO 8601 UTC timestamps, e.g. 2026-11-17T19:05:00.000Z.
export const DAILY_COLUMNS = ['name', 'asset', 'location', 'checkout', 'returned_at', 'note', 'id'];
export const MASTER_LOG_COLUMNS = ['id', 'name', 'asset', 'location', 'checkout', 'returned_at', 'note'];

// Stops with a clear message if the file isn't a checkouts database (for example the wrong
// file was copied in), instead of failing later on the first checkout.
function checkColumns(db, table, expected) {
  const found = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  const missing = expected.filter((c) => !found.has(c));
  if (missing.length) {
    throw new Error(`The "${table}" table in this database has no ${missing.join(', ')} column. Is it the right checkouts.db?`);
  }
}

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  // Wait instead of failing if another program (e.g. DB Browser for SQLite) is reading the file.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  checkColumns(db, 'daily', DAILY_COLUMNS);
  checkColumns(db, 'master_log', MASTER_LOG_COLUMNS);

  const dailyColumns = DAILY_COLUMNS.join(', ');
  const logColumns = MASTER_LOG_COLUMNS.join(', ');
  const sql = {
    checkedOut: db.prepare(`SELECT ${dailyColumns} FROM daily WHERE returned_at IS NULL ORDER BY checkout`),
    daily: db.prepare(`SELECT ${dailyColumns} FROM daily ORDER BY checkout`),
    history: db.prepare(`SELECT ${logColumns} FROM master_log ORDER BY returned_at DESC`),
    insert: db.prepare(`INSERT INTO daily (${dailyColumns}) VALUES (?, ?, ?, ?, NULL, NULL, ?)`),
    remove: db.prepare(`DELETE FROM daily WHERE id = ? RETURNING ${dailyColumns}`),
    log: db.prepare(`INSERT INTO master_log (${logColumns}) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  };

  return {
    db,

    // Items out right now, oldest first.
    checkedOut: () => sql.checkedOut.all(),
    // Every row of the daily table, for the Excel copy.
    daily: () => sql.daily.all(),
    // Every returned item, most recently returned first.
    history: () => sql.history.all(),

    checkOut({ name, asset, location }, now = new Date()) {
      const item = { name, asset, location, checkout: now.toISOString(), returned_at: null, note: null, id: randomUUID() };
      sql.insert.run(item.name, item.asset, item.location, item.checkout, item.id);
      return item;
    },

    // Moves the item from daily to master_log. Returns the returned item, or null if no item
    // with that id is checked out (it may have been returned already).
    checkIn(id, now = new Date()) {
      const returnedAt = now.toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        // An id should only ever match one row, but log every row removed so nothing is lost.
        const rows = sql.remove.all(id);
        for (const row of rows) {
          sql.log.run(row.id, row.name, row.asset, row.location, row.checkout, returnedAt, row.note);
        }
        db.exec('COMMIT');
        return rows.length ? { ...rows[0], returned_at: returnedAt } : null;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    close: () => db.close(),
  };
}
