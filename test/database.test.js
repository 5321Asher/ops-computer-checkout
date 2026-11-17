// The database must work with a checkouts.db from the first version, copied in as it is.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openDatabase } from '../lib/database.js';
import { ORIGINAL_SCHEMA, tempDir } from './helpers.js';

const schemaOf = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all().map((r) => ({ ...r }));
  const settings = {
    journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
    userVersion: db.prepare('PRAGMA user_version').get().user_version,
  };
  db.close();
  return { rows, settings };
};

// A database made the way the first version made it, with records written the way it wrote them.
function firstVersionDatabase() {
  const file = join(tempDir(), 'checkouts.db');
  const db = new DatabaseSync(file);
  for (const sql of ORIGINAL_SCHEMA) db.exec(sql);
  db.prepare('INSERT INTO daily (name, asset, location, checkout, returned_at, id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Old Customer', 'ops-555', 'Courtroom 9', '2026-02-25T15:03:22.123Z', null, 'aaaaaaaa-0000-4000-8000-000000000001');
  db.prepare('INSERT INTO master_log (id, asset, checkout, returned_at, name, location, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('aaaaaaaa-0000-4000-8000-000000000002', 'RSI-7', '2026-02-24T13:00:00.000Z', '2026-02-24T17:30:00.000Z', 'Earlier Customer', 'Room 2', null);
  db.close();
  return file;
}

test('a first-version checkouts.db opens without its layout or settings changing', () => {
  const file = firstVersionDatabase();
  const before = schemaOf(file);
  const store = openDatabase(file);
  store.checkIn(store.checkOut({ name: 'New', asset: 'OPS-1', location: 'Here' }).id);
  store.close();
  assert.deepEqual(schemaOf(file), before);
});

test("a first-version database's records can be listed and returned", () => {
  const store = openDatabase(firstVersionDatabase());
  const [out] = store.checkedOut();
  assert.equal(out.asset, 'ops-555');
  assert.equal(out.name, 'Old Customer');

  const returned = store.checkIn(out.id, new Date('2026-11-17T19:05:00.000Z'));
  assert.equal(returned.returned_at, '2026-11-17T19:05:00.000Z');
  assert.equal(store.checkedOut().length, 0);
  const history = store.history();
  assert.deepEqual(history.map((r) => r.asset), ['ops-555', 'RSI-7']); // most recently returned first
  assert.equal(history[0].checkout, '2026-02-25T15:03:22.123Z');
  store.close();
});

test('a brand-new database gets exactly the first version\'s tables', () => {
  const file = join(tempDir(), 'checkouts.db');
  openDatabase(file).close();
  const { rows, settings } = schemaOf(file);
  assert.deepEqual(rows.map((r) => r.sql), [...ORIGINAL_SCHEMA]);
  assert.equal(settings.journal, 'delete'); // the file alone holds everything, so copying it is safe
});

test('a note on a checked-out item is kept when it is returned', () => {
  const store = openDatabase(join(tempDir(), 'checkouts.db'));
  const item = store.checkOut({ name: 'A', asset: 'OPS-1', location: 'B' });
  store.db.prepare('UPDATE daily SET note = ? WHERE id = ?').run('screen cracked', item.id);
  store.checkIn(item.id);
  assert.equal(store.history()[0].note, 'screen cracked');
  store.close();
});

test('returning an item that is not checked out changes nothing', () => {
  const store = openDatabase(join(tempDir(), 'checkouts.db'));
  const item = store.checkOut({ name: 'A', asset: 'OPS-1', location: 'B' });
  assert.ok(store.checkIn(item.id));
  assert.equal(store.checkIn(item.id), null);
  assert.equal(store.checkIn('no-such-id'), null);
  assert.equal(store.history().length, 1);
  store.close();
});

test('a database with the wrong tables is refused with a clear message', () => {
  const file = join(tempDir(), 'checkouts.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE daily (something TEXT)');
  db.close();
  assert.throws(() => openDatabase(file), /"daily" table .* no name, asset, location, checkout, returned_at, note, id column/);
});
