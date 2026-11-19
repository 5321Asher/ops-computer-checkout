// Shared test helpers. Every test app gets its own temporary folder, standing in for the program's
// folder, so tests never touch real records.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../lib/app.js';

export const ROOT = join(import.meta.dirname, '..');

export const tempDir = () => mkdtempSync(join(tmpdir(), 'checkout-test-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until fn() returns something truthy, and returns it.
export async function waitFor(fn, { timeout = 5000, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > end) throw new Error(`timed out waiting for ${message}`);
    await sleep(25);
  }
}

// A logger that keeps what it's given instead of printing it.
export function quietLog() {
  const lines = [];
  const keep = (...parts) => lines.push(parts.map(String).join(' '));
  return { lines, log: keep, warn: keep, error: keep };
}

// The tables exactly as the first version's checkouts.db has them (from its sqlite_master).
export const ORIGINAL_SCHEMA = [
  'CREATE TABLE daily (\n  name TEXT,\n  asset TEXT,\n  location TEXT,\n  checkout TEXT,\n  returned_at TEXT,\n  note TEXT,\n  id TEXT\n)',
  'CREATE TABLE master_log (\n  id TEXT,\n  name TEXT,\n  asset TEXT,\n  location TEXT,\n  checkout TEXT,\n  returned_at TEXT,\n  note TEXT\n)',
];

// Starts the app on a free port. Failed writes are retried after 20-100 ms, not seconds.
export async function startApp({ home = tempDir(), retryDelays = [20, 50, 100] } = {}) {
  const config = { location: 'Test Location' };
  const log = quietLog();
  const app = buildApp({ dir: home, config, publicDir: join(ROOT, 'public'), retryDelays, log });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    ...app,
    home,
    config,
    log,
    base,
    get: (path) => fetch(base + path),
    post: (path, body = {}) => fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    async checkOut(details = {}) {
      const res = await this.post('/api/checkouts', { name: 'Jane Doe', asset: 'OPS-1234', location: 'Courtroom 3', ...details });
      if (res.status !== 201) throw new Error(`checkout failed: ${res.status} ${await res.text()}`);
      return (await res.json()).item;
    },
  };
}
