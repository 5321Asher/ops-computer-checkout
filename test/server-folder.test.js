// The location's server folder: only the three files RSOs need go there, and nothing is lost while
// the server can't be reached.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../lib/config.js';
import { ROOT, startApp, tempDir, waitFor } from './helpers.js';

const ticketScript = readFileSync(join(ROOT, 'createTickets.ps1'));

async function returnItem(app, details) {
  const item = await app.checkOut(details);
  assert.equal((await app.post(`/api/checkouts/${item.id}/return`)).status, 200);
}

test('the server folder gets the Excel copy, the ticket list and createTickets.ps1, and nothing else', async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  await returnItem(app, { asset: 'OPS-1' });
  await Promise.all([app.excel.runNow(), app.tickets.sendNow(), app.ticketScript.runNow()]);

  assert.deepEqual(readdirSync(app.serverFolder).sort(), ['checkouts.xlsx', 'createTickets.ps1', 'ticketList.json']);
  assert.deepEqual(readFileSync(app.ticketScriptPath), ticketScript);
  // The records, and the tickets waiting to go to the server, stay on this computer.
  assert.ok(existsSync(join(app.home, 'checkouts.db')));
  assert.ok(existsSync(join(app.home, 'pending-tickets.json')));
});

test("the server's createTickets.ps1 is replaced with this version's", async (t) => {
  const app = await startApp();
  t.after(() => app.close());
  writeFileSync(app.ticketScriptPath, '# an older version');
  await app.ticketScript.runNow();
  assert.deepEqual(readFileSync(app.ticketScriptPath), ticketScript);
});

test("while the server can't be reached, tickets wait on this computer, and everything is saved once it's back", async (t) => {
  const server = join(tempDir(), 'not-there-yet');
  const app = await startApp({ server });
  t.after(() => app.close());
  app.ticketScript.request();
  await returnItem(app, { asset: 'OPS-1' });
  await assert.rejects(app.excel.runNow());
  await assert.rejects(app.tickets.sendNow());
  assert.equal(JSON.parse(readFileSync(join(app.home, 'pending-tickets.json'), 'utf8')).length, 1);
  const status = await (await app.get('/api/status')).json();
  assert.equal(status.tickets.waiting, 1);
  assert.ok(status.excel.lastError);

  mkdirSync(server); // the server is back
  await waitFor(() => app.tickets.waiting() === 0 && app.excel.status().lastSuccessAt && existsSync(app.ticketScriptPath),
    { message: 'the retries' });
  assert.deepEqual(JSON.parse(readFileSync(app.ticketListPath, 'utf8')).map((t) => t.asset), ['OPS-1']);
  assert.deepEqual(readdirSync(server).sort(), ['checkouts.xlsx', 'createTickets.ps1', 'ticketList.json']);
});

test('config.json: serverFolder is read, and is optional', () => {
  const home = tempDir();
  assert.deepEqual(loadConfig(home), { location: '', serverFolder: '' });

  // Written by PowerShell 5.1: with a BOM, and \ written as \\.
  writeFileSync(join(home, 'config.json'), '﻿{ "location": " 46 Water Street ", "serverFolder": "\\\\\\\\server\\\\share\\\\46-water-street" }');
  const expected = process.platform === 'win32' ? '\\\\server\\share\\46-water-street' : join(home, '\\\\server\\share\\46-water-street');
  assert.deepEqual(loadConfig(home), { location: '46 Water Street', serverFolder: expected });

  writeFileSync(join(home, 'config.json'), '{ "location": "46 Water Street", "serverFolder": " " }');
  assert.equal(loadConfig(home).serverFolder, '');

  writeFileSync(join(home, 'config.json'), '{ "location": "46 Water Street", "serverFolder": 5 }');
  assert.throws(() => loadConfig(home), (err) => err instanceof ConfigError && /serverFolder/.test(err.message));
});
