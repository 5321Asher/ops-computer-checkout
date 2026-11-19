// The ticket list: every return adds a ticket, and no ticket is ever lost.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withLock } from '../lib/files.js';
import { createTicketQueue } from '../lib/tickets.js';
import { quietLog, startApp, tempDir, waitFor } from './helpers.js';

const readList = (path) => JSON.parse(readFileSync(path, 'utf8'));

async function returnItem(app, details) {
  const item = await app.checkOut(details);
  const res = await app.post(`/api/checkouts/${item.id}/return`);
  assert.equal(res.status, 200);
  return item;
}

test('a list emptied by createTickets.ps1 in Windows PowerShell 5.1 (with a BOM) still works', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  writeFileSync(app.ticketListPath, '﻿[]\r\n'); // exactly what Set-Content -Encoding UTF8 writes
  await returnItem(app, { asset: 'OPS-1' });
  await app.tickets.sendNow();
  const text = readFileSync(app.ticketListPath, 'utf8');
  assert.notEqual(text.charCodeAt(0), 0xfeff);
  assert.deepEqual(JSON.parse(text).map((t) => t.asset), ['OPS-1']);
});

test('a missing or blank list is started fresh', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await returnItem(app, { asset: 'OPS-1' });
  await app.tickets.sendNow();
  assert.equal(readList(app.ticketListPath).length, 1);

  writeFileSync(app.ticketListPath, '  \r\n');
  await returnItem(app, { asset: 'OPS-2' });
  await app.tickets.sendNow();
  assert.deepEqual(readList(app.ticketListPath).map((t) => t.asset), ['OPS-2']);
});

test('tickets already in the list, including ones from the first version, are kept', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const old = { asset: 'ops-9', checkout: '2026-02-25T15:00:00.000Z', return: '2026-02-25T17:00:00.000Z', user: 'Old', location: 'Room', rso: '', status: 'Returned' };
  writeFileSync(app.ticketListPath, JSON.stringify([old], null, 2));
  await returnItem(app, { asset: 'OPS-1' });
  await app.tickets.sendNow();
  const list = readList(app.ticketListPath);
  assert.deepEqual(list[0], old);
  assert.equal(list[1].asset, 'OPS-1');
});

test('a list that is not valid JSON is never overwritten; tickets wait until it is fixed', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  writeFileSync(app.ticketListPath, '[{"asset": "OPS-0", oops');
  await returnItem(app, { asset: 'OPS-1' });
  await assert.rejects(app.tickets.sendNow(), /is not valid JSON/);
  assert.equal(readFileSync(app.ticketListPath, 'utf8'), '[{"asset": "OPS-0", oops');

  const status = await (await app.get('/api/status')).json();
  assert.equal(status.tickets.waiting, 1);
  assert.match(status.tickets.lastError, /not valid JSON/);

  writeFileSync(app.ticketListPath, '[]');
  await waitFor(() => app.tickets.waiting() === 0, { message: 'the retry' });
  assert.deepEqual(readList(app.ticketListPath).map((t) => t.asset), ['OPS-1']);
});

test('tickets that could not be added are kept through a restart and added later', async () => {
  const home = tempDir();
  const first = await startApp({ home });
  writeFileSync(first.ticketListPath, '[ broken'); // e.g. edited by hand
  await returnItem(first, { asset: 'OPS-1' });
  await returnItem(first, { asset: 'OPS-2' });
  await assert.rejects(first.tickets.sendNow(), /not valid JSON/);
  await first.close();
  assert.equal(JSON.parse(readFileSync(join(home, 'pending-tickets.json'), 'utf8')).length, 2);

  writeFileSync(first.ticketListPath, '[]'); // fixed while the program was off
  const second = await startApp({ home });
  await waitFor(() => second.tickets.waiting() === 0, { message: 'the waiting tickets' });
  assert.deepEqual(readList(second.ticketListPath).map((t) => t.asset), ['OPS-1', 'OPS-2']);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'pending-tickets.json'), 'utf8')), []);
  await second.close();
});

test('a ticket sent twice (the program stopped halfway) is only added once', async () => {
  const dir = tempDir();
  const ticketListPath = join(dir, 'ticketList.json');
  const ticket = { asset: 'OPS-1', checkout: 'a', return: 'b', user: 'u', location: 'l', rso: '', status: 'Returned', id: 'same-id' };
  writeFileSync(ticketListPath, JSON.stringify([ticket]));
  writeFileSync(join(dir, 'pending-tickets.json'), JSON.stringify([ticket]));
  const queue = createTicketQueue({ pendingPath: join(dir, 'pending-tickets.json'), ticketListPath, log: quietLog() });
  await waitFor(() => queue.waiting() === 0);
  await queue.stop();
  assert.equal(readList(ticketListPath).length, 1);
});

test('the program waits while createTickets.ps1 holds the lock', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const lock = `${app.ticketListPath}.lock`;
  writeFileSync(lock, 'createTickets.ps1 on RSO-PC');
  await returnItem(app, { asset: 'OPS-1' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(existsSync(app.ticketListPath), false);

  rmSync(lock); // createTickets.ps1 is done
  await waitFor(() => app.tickets.waiting() === 0, { message: 'the ticket after the lock is released' });
  assert.equal(readList(app.ticketListPath).length, 1);
  assert.equal(existsSync(lock), false);
});

test('a lock left behind by a program that stopped halfway is cleared after 2 minutes', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  const lock = `${app.ticketListPath}.lock`;
  writeFileSync(lock, 'left behind');
  const threeMinutesAgo = new Date(Date.now() - 3 * 60_000);
  utimesSync(lock, threeMinutesAgo, threeMinutesAgo);
  await returnItem(app, { asset: 'OPS-1' });
  await app.tickets.sendNow();
  assert.equal(readList(app.ticketListPath).length, 1);
  assert.equal(existsSync(lock), false);
});

test('the lock lets only one writer in at a time', async () => {
  const lock = join(tempDir(), 'list.lock');
  let inside = 0;
  let mostInside = 0;
  await Promise.all(Array.from({ length: 5 }, () => withLock(lock, async () => {
    inside += 1;
    mostInside = Math.max(mostInside, inside);
    await new Promise((resolve) => setTimeout(resolve, 20));
    inside -= 1;
  })));
  assert.equal(mostInside, 1);
  assert.equal(existsSync(lock), false);
});

test('a damaged pending-tickets.json is kept for recovery and does not stop the program', async () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'pending-tickets.json'), '{ broken');
  const log = quietLog();
  const queue = createTicketQueue({ pendingPath: join(dir, 'pending-tickets.json'), ticketListPath: join(dir, 'ticketList.json'), log });
  assert.equal(queue.waiting(), 0);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith('pending-tickets.json.damaged-')).length, 1);
  assert.match(log.lines[0], /was damaged/);
  await queue.stop();
});
