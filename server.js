// Equipment Checkout: check equipment in and out at a location.
// Start it with start.cmd (or `npm start`), then open http://localhost:3000.
//
// Everything is kept in this program's folder: the records (checkouts.db), an Excel copy of them
// (checkouts.xlsx), and the ticket list (ticketList.json) that createTickets.ps1 turns into tickets.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Equipment Checkout needs Node.js 22.13 or newer. This computer has ${process.version}.`);
  process.exit(1);
}
// Imported after the version check, so older Node versions get the clear message above.
const { join } = await import('node:path');
const { ConfigError, loadConfig } = await import('./lib/config.js');
const { buildApp } = await import('./lib/app.js');

const APP_DIR = import.meta.dirname;
// Where the records and config.json are: this folder, unless the tests point elsewhere.
const HOME = process.env.CHECKOUT_HOME || APP_DIR;
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

let config;
try {
  config = loadConfig(HOME);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const app = buildApp({ dir: HOME, config, publicDir: join(APP_DIR, 'public') });

app.server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Equipment Checkout may already be running: open http://localhost:${PORT} in your browser.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

app.server.listen(PORT, HOST, () => {
  console.log(`Equipment Checkout is running${config.location ? ` for ${config.location}` : ''}.`);
  console.log(`Open http://localhost:${PORT} in your web browser.`);
  console.log(`Records are saved in ${join(HOME, 'checkouts.db')}`);
  console.log(`Excel copy: ${app.excelPath}`);
  console.log(`Ticket list: ${app.ticketListPath}`);
  console.log('Keep this window open while you use the program. To stop it, close this window or press Ctrl+C.');
  // Bring the Excel copy up to date, in case it missed changes while the program was off.
  app.excel.request();
});

// Closing the window (SIGHUP on Windows) or Ctrl+C: finish what's under way, then stop.
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const waiting = app.tickets.waiting();
    if (waiting) console.log(`${waiting} ticket(s) couldn't be added to the ticket list yet; they will be added next time the program starts.`);
    // Don't hang on a save that's stuck; nothing is lost by stopping anyway.
    setTimeout(() => process.exit(0), 8000).unref();
    await app.close();
    process.exit(0);
  });
}
