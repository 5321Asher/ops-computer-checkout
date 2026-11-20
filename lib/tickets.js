// The ticket list: every returned item becomes a ticket for an RSO to file. Tickets are added to
// ticketList.json in the location's server folder; createTickets.ps1, next to it, turns them into
// tickets.txt and empties the list.
//
// A return must never lose its ticket, even while ticketList.json can't be written (the server
// can't be reached, createTickets.ps1 is using it, or it was broken by hand), so each ticket is
// first saved on this computer in pending-tickets.json and then added to the list in the
// background, retrying until it works.
//
// This program and createTickets.ps1 both change ticketList.json, so they take turns using a lock
// file next to it (ticketList.json.lock); see withLock in files.js.

import { readFileSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { backgroundJob } from './background.js';
import { stripBom, withLock, writeFileAtomic, writeFileAtomicSync } from './files.js';

// The format createTickets.ps1 reads. `id` (the checkout's id) lets a ticket that was sent
// twice, e.g. if the program stopped halfway through sending, be recognised and added once.
export function ticketFor(item) {
  return {
    asset: item.asset,
    checkout: item.checkout,
    return: item.returned_at,
    user: item.name,
    location: item.location,
    rso: '',
    status: 'Returned',
    id: item.id,
  };
}

// The tickets in ticketList.json. A missing or empty file is an empty list. A file that isn't a
// JSON list throws, so it isn't overwritten: someone needs to look at it.
async function readTicketList(path) {
  let text;
  try {
    text = stripBom(await readFile(path, 'utf8')).trim();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (!text) return [];
  let list;
  try {
    list = JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err.message}). Fix or empty it (to []) and the waiting tickets will be added.`);
  }
  if (!Array.isArray(list)) throw new Error(`${path} should contain a list ([...]). Fix it and the waiting tickets will be added.`);
  return list;
}

export function createTicketQueue({ pendingPath, ticketListPath, log = console, retryDelays }) {
  let pending = loadPending();
  const job = backgroundJob('Ticket list', send, { log, retryDelays });
  if (pending.length) {
    log.log(`${pending.length} ticket(s) from last time are waiting to be added to ${ticketListPath}.`);
    job.request();
  }

  function loadPending() {
    let text;
    try {
      text = stripBom(readFileSync(pendingPath, 'utf8')).trim();
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    try {
      const list = text ? JSON.parse(text) : [];
      if (Array.isArray(list)) return list;
    } catch {
      // handled below
    }
    // Keep the damaged file for whoever wants to recover tickets from it, and carry on.
    const aside = `${pendingPath}.damaged-${Date.now()}`;
    renameSync(pendingPath, aside);
    log.error(`${pendingPath} was damaged and was renamed to ${aside}. Tickets in it were not sent.`);
    return [];
  }

  function savePending() {
    try {
      writeFileAtomicSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`);
    } catch (err) {
      // Still sent from memory; only a restart before then would lose them.
      log.error(`Could not save waiting tickets to ${pendingPath}: ${err.message}`);
    }
  }

  async function send() {
    if (!pending.length) return;
    const batch = [...pending];
    await withLock(`${ticketListPath}.lock`, async () => {
      const list = await readTicketList(ticketListPath);
      const already = new Set(list.map((t) => t?.id).filter(Boolean));
      list.push(...batch.filter((t) => !already.has(t.id)));
      await writeFileAtomic(ticketListPath, `${JSON.stringify(list, null, 2)}\n`);
    });
    // Tickets added while this was sending stay waiting for the next run.
    const sent = new Set(batch);
    pending = pending.filter((t) => !sent.has(t));
    savePending();
  }

  return {
    add(ticket) {
      pending.push(ticket);
      savePending();
      job.request();
    },
    waiting: () => pending.length,
    status: () => ({ ...job.status(), waiting: pending.length }),
    sendNow: () => job.runNow(),
    stop: () => job.stop(),
  };
}
