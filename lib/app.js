// The web server: the two pages and the JSON API they use.
//
// It only listens on this computer (see server.js), only answers requests addressed to
// localhost, and only accepts changes sent by its own pages, so other computers and other
// websites open in the browser can't use it.

import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { backgroundJob } from './background.js';
import { openDatabase } from './database.js';
import { excelDownload, saveExcelFile } from './excel.js';
import { writeFileIfChanged } from './files.js';
import { createTicketQueue, ticketFor } from './tickets.js';

const MAX_BODY_BYTES = 16 * 1024;
// The script RSOs run to turn the ticket list into tickets; a copy is kept next to the list.
const TICKET_SCRIPT = join(import.meta.dirname, '..', 'createTickets.ps1');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SECURITY_HEADERS = {
  // Pages may only load this program's own files: no inline scripts, nothing from the internet.
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Checkout details ----------

const FIELDS = { name: ['Customer', 100], asset: ['Asset', 100], location: ['Location', 100] };

// Trimmed, with line breaks, tabs and runs of spaces turned into single spaces.
const clean = (value) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim() : '');

export function parseCheckout(body) {
  const name = clean(body?.name);
  const location = clean(body?.location);
  // Asset tags sometimes end in "CSD" (OPS-1234CSD, OPS-1234 CSD), which isn't part of the asset number.
  const asset = clean(body?.asset).toUpperCase().replace(/[\s-]*CSD$/, '');
  const item = { name, asset, location };

  if (!name || !asset || !location) throw new HttpError(400, 'Please fill out all fields.');
  for (const [field, [label, max]] of Object.entries(FIELDS)) {
    if (item[field].length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  }
  return item;
}

const NOTE_MAX = 500;

// The note from a request: trimmed, on one line. An empty note is null, which removes it.
export function parseNote(body) {
  if (typeof body?.note !== 'string') throw new HttpError(400, 'Send the note as text.');
  const note = clean(body.note);
  if (note.length > NOTE_MAX) throw new HttpError(400, `Note must be ${NOTE_MAX} characters or fewer.`);
  return note || null;
}

// The checkout id from a request's path.
function decodeId(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'That checkout id is not valid.');
  }
}

// ---------- Requests and responses ----------

function send(res, status, body, type, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': body.length, ...headers });
  res.end(body);
}

const sendJson = (res, status, data) =>
  send(res, status, Buffer.from(JSON.stringify(data)), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });

async function readJson(req) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Request is not valid JSON.');
  }
}

// Every file directly in public/, read once at start-up. Only these paths are served, so a
// request can never reach any other file on the computer.
function loadPages(dir) {
  const pages = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const type = CONTENT_TYPES[extname(entry.name)];
    if (entry.isFile() && type) pages.set(`/${entry.name}`, { type, body: readFileSync(join(dir, entry.name)) });
  }
  pages.set('/', pages.get('/index.html'));
  pages.set('/admin', pages.get('/admin.html'));
  return pages;
}

// ---------- The app ----------

// Sets up the server. Call listen() on the returned server.
//   dir          the program's folder, on this computer: the records (checkouts.db) and the
//                tickets waiting to go to the server (pending-tickets.json)
//   config       from loadConfig: { location, serverFolder }. The server folder gets the Excel copy
//                (checkouts.xlsx), the ticket list (ticketList.json) and createTickets.ps1; with
//                no server folder they go in `dir`.
//   retryDelays  how long to wait between tries when a file can't be written (tests use short ones)
export function buildApp({ dir, config, publicDir, retryDelays, log = console }) {
  const serverFolder = config.serverFolder || dir;
  const excelPath = join(serverFolder, 'checkouts.xlsx');
  const ticketListPath = join(serverFolder, 'ticketList.json');
  const ticketScriptPath = join(serverFolder, 'createTickets.ps1');
  const store = openDatabase(join(dir, 'checkouts.db'));
  const excel = backgroundJob('Excel copy',
    () => saveExcelFile(excelPath, { daily: store.daily(), history: store.history() }, log),
    { retryDelays, log });
  // Keeps the server's copy of createTickets.ps1 the same as this version's.
  const ticketScriptText = readFileSync(TICKET_SCRIPT);
  const ticketScript = backgroundJob('createTickets.ps1',
    () => writeFileIfChanged(ticketScriptPath, ticketScriptText),
    { retryDelays, log });
  const tickets = createTicketQueue({
    pendingPath: join(dir, 'pending-tickets.json'),
    ticketListPath,
    retryDelays,
    log,
  });
  const pages = loadPages(publicDir);

  // Requests must be addressed to this computer by name. This stops a website from reaching the
  // program by pointing one of its own addresses at this computer ("DNS rebinding").
  const allowedHosts = () => {
    const { port } = server.address();
    return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  };

  // Changes must come from this program's own pages, sent as JSON. A form on another website
  // can't send JSON, and the browser marks its requests with that website's address.
  function checkSentByOwnPage(req) {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts().has(origin.replace(/^http:\/\//, ''))) {
      throw new HttpError(403, "Changes can only be made from this program's own pages.");
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'Requests must be sent as JSON.');
  }

  async function handle(req, res) {
    if (!allowedHosts().has(req.headers.host ?? '')) {
      throw new HttpError(403, `Open this program at http://localhost:${server.address().port}`);
    }
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const page = pages.get(pathname);
      if (page) return send(res, 200, page.body, page.type, { 'Cache-Control': 'no-cache' });
    }
    if (req.method === 'POST') checkSentByOwnPage(req);

    const route = `${req.method} ${pathname}`;
    if (route === 'GET /api/checkouts') return sendJson(res, 200, store.checkedOut());
    if (route === 'GET /api/history') return sendJson(res, 200, store.history());

    if (route === 'POST /api/checkouts') {
      const item = store.checkOut(parseCheckout(await readJson(req)));
      excel.request();
      return sendJson(res, 201, { message: `${item.asset} checked out successfully.`, item });
    }

    const returning = req.method === 'POST' && pathname.match(/^\/api\/checkouts\/([^/]{1,200})\/return$/);
    if (returning) {
      const item = store.checkIn(decodeId(returning[1]));
      if (!item) throw new HttpError(404, 'That item is not checked out. It may have been returned already; the list has been refreshed.');
      tickets.add(ticketFor(item));
      excel.request();
      return sendJson(res, 200, { message: `${item.asset} returned successfully.`, item });
    }

    // Works for items checked out now and ones already returned, so a note can be added after the
    // item comes back too.
    const noting = req.method === 'POST' && pathname.match(/^\/api\/checkouts\/([^/]{1,200})\/note$/);
    if (noting) {
      const id = decodeId(noting[1]);
      const note = parseNote(await readJson(req));
      if (!store.setNote(id, note)) throw new HttpError(404, 'That checkout was not found. The lists have been refreshed.');
      excel.request();
      return sendJson(res, 200, { message: note ? 'Note saved.' : 'Note removed.', note });
    }

    if (route === 'GET /api/status') {
      return sendJson(res, 200, {
        location: config.location,
        serverFolder,
        excel: { ...excel.status(), path: excelPath },
        tickets: { ...tickets.status(), path: ticketListPath },
      });
    }

    if (route === 'POST /api/excel/save') {
      try {
        await excel.runNow();
      } catch (err) {
        throw new HttpError(503, `Could not save the Excel file: ${err.message}. If it's open in Excel, close it. It keeps trying by itself, including while the server can't be reached.`);
      }
      return sendJson(res, 200, { message: `Saved to ${excelPath}` });
    }

    if (route === 'GET /api/export') {
      const file = await excelDownload({ daily: store.daily(), history: store.history() });
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
      return send(res, 200, file, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', {
        'Content-Disposition': `attachment; filename="checkouts-${today}.xlsx"`,
        'Cache-Control': 'no-store',
      });
    }

    throw new HttpError(404, 'Not found.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      log.error(new Date().toISOString(), err);
      // Each change is a single database transaction, so a failure means nothing was changed.
      sendJson(res, 500, { error: req.method === 'GET'
        ? 'Something went wrong on the server. Please reload the page.'
        : 'Something went wrong on the server, so nothing was saved. Please try again.' });
    }
  });

  return {
    server,
    store,
    excel,
    tickets,
    ticketScript,
    serverFolder,
    excelPath,
    ticketListPath,
    ticketScriptPath,
    // Stops taking requests, lets a save that's under way finish, and closes the database.
    async close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
      await Promise.all([excel.stop(), tickets.stop(), ticketScript.stop()]);
      store.close();
    },
  };
}
