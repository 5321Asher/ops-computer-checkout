// File helpers for writing safely, mostly to the server folder, where files can be open in another
// program (the Excel file in Excel), changed by another program at the same time (the ticket list,
// by createTickets.ps1), or the server can drop out halfway through a write.

import { randomBytes } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows PowerShell 5.1 starts UTF-8 files with a byte order mark, which JSON.parse rejects.
export const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const tempName = (path) => `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;

// Readers only ever see the old file or the new one, never half of one: the data goes to a
// temporary file in the same folder, which then replaces the original. If the original is open
// in a program that won't let it be replaced (Excel does this), the write fails and the
// original is left exactly as it was.
export async function writeFileAtomic(path, data) {
  const tmp = tempName(path);
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export function writeFileAtomicSync(path, data) {
  const tmp = tempName(path);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

// Writes `data` to `path` only if the file isn't already exactly that.
export async function writeFileIfChanged(path, data) {
  const current = await readFile(path).catch(() => null);
  if (current?.equals(data)) return;
  await writeFileAtomic(path, data);
}

// A lock file older than this is left over from a program that stopped halfway, and is removed.
// Holders only keep the lock for well under a second.
export const STALE_LOCK_MS = 2 * 60_000;

// Runs fn while holding `lockPath`. Whoever creates the lock file first holds it; everyone else
// waits. createTickets.ps1 uses the same lock file in the same way.
export async function withLock(lockPath, fn, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`${lockPath} has been locked by another program for over ${timeoutMs / 1000} seconds`);
      }
      await sleep(200);
      continue;
    }
    try {
      try {
        // Who holds the lock, for anyone who finds it left behind.
        await handle.writeFile(`Equipment Checkout on ${hostname()}, process ${process.pid}, ${new Date().toISOString()}\n`);
      } finally {
        await handle.close();
      }
      return await fn();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}
