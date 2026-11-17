# Equipment Checkout V2
###### By: Asher Virgona

Check OPS and RSI computers in and out at a location. Each location runs the program on one computer, which keeps the records in a local SQLite database (`checkouts.db`), so it works even when the network is down. It also keeps two copies on the server share, for people who don't use the program:

- **`checkouts.xlsx`**: an Excel copy of every record, updated after every change.
- **`ticketList.json`**: a ticket for every returned item, which RSOs turn into `tickets.txt` with `createTickets.ps1`.

## How it's laid out

```
\\jus00adc1140\library\Scripts\equipment_checkout_v2\
  setup.ps1                 sets up a location (run on the location's computer)
  template\                 what every location starts from (made by publish-template.ps1)
    code\                   the program, with its modules already installed
    createTickets.ps1
    ticketList.json
  46-water-street\          one folder per location (made by setup.ps1)
    code\                   the location's copy of the program, with its config.json
    createTickets.ps1       RSOs run this to make tickets.txt
    ticketList.json         tickets waiting to be made
    tickets.txt             the last tickets made
    checkouts.xlsx          the Excel copy

C:\equipment_checkout\      the program on the location's computer
  checkouts.db              the records
```

Everything refers to the share by its full `\\jus00adc1140\library` path, never `Z:`, so it works on computers where `Z:` isn't mapped.

## What you need

- **On each location's computer:** [Node.js](https://nodejs.org), version 22.13 or newer (the current LTS is best). Nothing else: no npm and no Global Connect.
- **To publish the template:** a copy of this repository, Node.js with npm, Global Connect (for the npm registry), and write access to the share.

## Publishing the template

The template on the share is what `setup.ps1` installs. Publish it once now, and again whenever the program changes or its dependencies are updated. On your own computer, in the repository folder:

```powershell
git pull
.\deploy\publish-template.ps1
```

This copies only the program files, installs the exact module versions from `package-lock.json` (`npm ci`), and swaps the result into `template\code` in one step, so a failure partway never leaves a half-written template. It writes `code\VERSION.txt` (the git commit and date), so you can always tell what a location is running. It also copies `setup.ps1` and the template's `createTickets.ps1` to the share.

Publishing doesn't change any location. A location keeps its program until `setup.ps1` is run there again.

## Setting up a location

On the location's computer, open `\\jus00adc1140\library\Scripts\equipment_checkout_v2\`, then right-click `setup.ps1` and choose **Run with PowerShell**. It:

1. Asks for the location's name, e.g. `46 Water Street`, which names its folder: `46-water-street`.
2. Copies `template\` to that folder and points it at itself. It writes `code\config.json` and fills in the folder path in `createTickets.ps1`.
   - If the folder already exists (a new computer, or an upgrade), it offers to **reuse** it. That updates the program and `createTickets.ps1` but never touches the location's Excel file, ticket list or `tickets.txt`.
3. Asks where to put the program on this computer (default `C:\equipment_checkout`) and copies the location's `code\` folder there.
   - Records already in that folder (`checkouts.db`) are kept, and a copy is saved first as `checkouts-before-setup-<date>.db`.
   - It refuses to use a folder that has unrelated files in it.

Close the program before running setup; setup will tell you if it's still running.

### Upgrading from the first version

The database is unchanged, so the old records carry straight over:

- **Same folder (e.g. `C:\equipment_checkout`):** run setup with that folder. Its `checkouts.db` stays where it is.
- **Different folder or computer:** after setup, copy the old `checkouts.db` into the new folder before starting the program.

The old version was opened as `index.html` from a folder. The new one is opened at **http://localhost:3000**; `start.cmd` opens it for you.

## Daily use

Double-click **`start.cmd`** in the program's folder. It starts the program and opens http://localhost:3000. Keep its window open while the program is in use; closing the window stops it.

- **Checkout page** (`/`): check items out (customer, `OPS-` or `RSI-` asset, location), and search and return the ones that are out. Asset numbers are saved in capitals, and a `CSD` on the end is removed.
- **Admin page** (`/admin.html`): everything checked out, the full history, today's numbers, and how the copies on the share are doing.
  - **Save to Server** writes the Excel copy now.
  - **Download Excel** saves a copy to this computer.

Only this computer can use the program. It doesn't answer other computers, and other websites open in the browser can't use it.

## The copies on the share

### Excel copy (`checkouts.xlsx`)

After every checkout and return, and when the program starts, the program rebuilds the **Daily Checkouts** and **Master Log** sheets from the database. Times show as real Excel dates in this computer's local time. The header row is frozen and has filters.

- **The file is open in Excel, or the share is down:** the save is retried by itself (after 2, 5, 10, 30, then every 60 seconds) until it works. Because the sheets are rebuilt from the whole database each time, the next save that works brings the file fully up to date. The admin page shows when it last saved, or what's wrong.
- **Other sheets in the workbook:** kept, along with their tab order. ExcelJS can't keep charts or pivot tables, so keep those in a separate workbook that links to this one.
- **The file can't be read** (share down, no permission): it's never overwritten; the save just waits.
- **The file isn't a workbook at all** (damaged): it's renamed to `checkouts-unreadable-<date>.xlsx`, so nothing in it is lost, and a new one is started.

### Ticket list (`ticketList.json`)

Every return adds a ticket:

```json
{ "asset": "OPS-1234", "checkout": "2026-11-17T14:00:00.000Z", "return": "2026-11-17T19:05:00.000Z",
  "user": "Jane Doe", "location": "Courtroom 3", "rso": "", "status": "Returned", "id": "…" }
```

Each ticket is saved on the computer first (`pending-tickets.json`) and then added to the list on the share. If the share can't be reached, tickets wait safely, even through a restart, and are added when it's back. If `ticketList.json` isn't valid JSON, it's never overwritten: the admin page says so, and the tickets are added once it's fixed (or emptied to `[]`).

### Making tickets (`createTickets.ps1`)

RSOs right-click the location's `createTickets.ps1` and choose **Run with PowerShell**. It asks to confirm, asks for their name, and writes every ticket to `tickets.txt` in the same format as before, then empties the list. Make sure the tickets in the old `tickets.txt` have been filed first.

```
Please assign ticket to JC -> MAG DISTRIBUTED SUPPORT -> JUS MAG CS RSO TORONTO -> <RSO name>.
Machine Name: OPS-1234
Courtroom: Courtroom 3
DESCRIPTION: Client Jane Doe requested equipment at 2026-11-17 9:00 AM
Resolution: Equipment returned at 2026-11-17 2:05 PM
```

Times are local, and the same on every PowerShell version. The program and the script take turns with the list using a lock file (`ticketList.json.lock`), so a return made while the script runs is never lost. A lock left over from a crash is cleared after 2 minutes.

## Settings (`config.json`)

`setup.ps1` writes `config.json` in the program's folder:

```json
{
    "location": "46 Water Street",
    "locationFolder": "\\\\jus00adc1140\\library\\Scripts\\equipment_checkout_v2\\46-water-street"
}
```

`locationFolder` is where `checkouts.xlsx` and `ticketList.json` go. In JSON, each `\` is written `\\`. The program won't start without `config.json`, so it can never write to the wrong place. `config.example.json` is a starting point for setting one up by hand.

## Utilities

- **`npm run clear-db`**: VERY DANGEROUS. Deletes every record, both checked out and history. Stop the program first. It saves a copy as `checkouts-before-clear-<date>.db`, and only goes ahead if you type `CLEAR`.

## For developers

```
server.js            starts the program (reads config.json, opens the database, listens on 127.0.0.1:3000)
lib/app.js           the web server: pages, API, security checks
lib/database.js      checkouts.db (the tables are exactly the first version's)
lib/excel.js         the Excel copy
lib/tickets.js       the ticket list and its local queue
lib/background.js    retries writes to the share until they work
lib/files.js         safe file writes and the lock file
lib/config.js        reads config.json
public/              the two pages (plain HTML, CSS and JavaScript modules)
deploy/              publish-template.ps1, setup.ps1, createTickets.ps1
scripts/clear-db.js
test/                tests (node:test)
```

The only dependency is [ExcelJS](https://github.com/exceljs/exceljs). The database is Node's built-in `node:sqlite`, and the server is Node's built-in `http`. `package.json` pins patched versions of a few of ExcelJS's own dependencies (`overrides`); `npm audit` should report 0 vulnerabilities.

Run the tests with `npm test`. The browser tests use Chrome, Chromium or Edge if one is installed, and are skipped otherwise.

To try the program locally, copy `config.example.json` to `config.json` and set `locationFolder` to a local folder (a relative path is relative to the program's folder), then run `npm start`.

### API

All replies are JSON (except the download). Changes must be sent as JSON from the program's own pages.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/checkouts` | Items checked out now, oldest first |
| POST | `/api/checkouts` | Check out `{ name, asset, location }` |
| POST | `/api/checkouts/:id/return` | Return an item: moves it to the history and adds a ticket |
| GET | `/api/history` | Every returned item, most recent first |
| GET | `/api/status` | The location, and how the Excel copy and ticket list are doing |
| POST | `/api/excel/save` | Write the Excel copy now |
| GET | `/api/export` | Download the records as an Excel file |
