// Starting and stopping server.js itself, as start.cmd does.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, tempDir, waitFor } from './helpers.js';

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function runServer(home, port) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'server.js')], {
    env: { ...process.env, CHECKOUT_HOME: home, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  return { child, output: () => output };
}

function homeWithConfig(config = {}) {
  const home = tempDir();
  writeFileSync(join(home, 'config.json'), `﻿${JSON.stringify({ location: 'Test Location', ...config })}`);
  return home;
}

test('without config.json the program still starts, with no location shown', async () => {
  const { child, output } = await runServer(tempDir(), await freePort());
  await waitFor(() => output().includes('Keep this window open'), { message: 'start-up', timeout: 10_000 });
  assert.match(output(), /Equipment Checkout is running\./);
  assert.match(output(), /No server folder is set in config\.json/);
  child.kill('SIGINT');
  await once(child, 'exit');
});

test('a config.json with a mistake is explained', async () => {
  const home = tempDir();
  writeFileSync(join(home, 'config.json'), '{ location: 46 Water Street }');
  const { child, output } = await runServer(home, await freePort());
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(output(), /config\.json is not valid JSON.*It should look like \{ "location": "46 Water Street", "serverFolder": .*Run setup\.ps1 again/);
});

test('it starts, saves to the server folder, serves the pages, and stops cleanly on Ctrl+C', { skip: process.platform === 'win32' }, async () => {
  const server = tempDir();
  const home = homeWithConfig({ serverFolder: server }); // written with a BOM, like PowerShell 5.1 would
  const port = await freePort();
  const { child, output } = await runServer(home, port);
  await waitFor(() => output().includes('Keep this window open'), { message: 'start-up', timeout: 10_000 });
  assert.match(output(), /running for Test Location/);
  assert.match(output(), new RegExp(`http://localhost:${port}`));
  assert.ok(output().includes(`ticket list and createTickets.ps1 are saved in ${server}`));

  const page = await fetch(`http://localhost:${port}/`);
  assert.equal(page.status, 200);
  await waitFor(() => existsSync(join(server, 'checkouts.xlsx')) && existsSync(join(server, 'createTickets.ps1')),
    { message: 'the Excel copy and createTickets.ps1' });
  assert.ok(existsSync(join(home, 'checkouts.db')));
  assert.ok(!existsSync(join(home, 'checkouts.xlsx')));

  child.kill('SIGINT');
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
});

test('a second copy explains that the program is already running', async () => {
  const home = homeWithConfig();
  const port = await freePort();
  const first = await runServer(home, port);
  await waitFor(() => first.output().includes('Keep this window open'), { timeout: 10_000 });
  const second = await runServer(homeWithConfig(), port);
  const [code] = await once(second.child, 'exit');
  assert.equal(code, 1);
  assert.match(second.output(), /Port \d+ is already in use. Equipment Checkout may already be running/);
  first.child.kill('SIGINT');
  await once(first.child, 'exit');
});
