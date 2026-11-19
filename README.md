# Equipment Checkout V2
###### By: Asher Virgona

Check equipment in and out at a location. Each location runs the program on one computer, and everything it needs and keeps is in one folder on that computer, so it works even when the network is down:

- **`checkouts.db`**: the records, in a SQLite database.
- **`checkouts.xlsx`**: an Excel copy of every record, updated after every change, for people who don't use the program.
- **`ticketList.json`**: a ticket for every returned item, which RSOs turn into `tickets.txt` with `createTickets.ps1`.

## How it's laid out

```
C:\equipment_checkout\      the program's folder (setup.ps1 makes it)
  start.cmd                 starts the program
  createTickets.ps1         RSOs run this to make tickets.txt
  checkouts.db              the records
  checkouts.xlsx            the Excel copy
  ticketList.json           tickets waiting to be made
  tickets.txt               the last tickets made
  config.json               the location's name
  VERSION.txt               which version is installed, and when
  server.js, lib\, public\, scripts\, node_modules\, ...   the program itself
```

Nothing outside this folder is used.

## What you need

- **On the location's computer:** [Node.js](https://nodejs.org), version 22.13 or newer (the current LTS is best; npm comes with it). During setup it also needs Global Connect, so npm can download the program's modules. After that, the program runs without it.
- **A copy of this repository** on that computer (a `git clone`, or the ZIP from GitHub, unzipped). Setup copies the program from it.

## Setting up a location

Connect to Global Connect, open the copy of the repository, then right-click `deploy\setup.ps1` and choose **Run with PowerShell**. It first checks that Node.js is new enough and that npm can reach the npm registry, and stops before changing anything if not. Then it:

1. Asks which folder to install in (default `C:\equipment_checkout`). The folder must be new or empty: setup refuses any folder that already has files in it, so it can never overwrite a location's records.
2. Asks for the location's name, e.g. `46 Water Street`, which is shown at the top of the pages.
3. Copies the program into the folder, along with `createTickets.ps1` and an empty `ticketList.json`, and writes `config.json` and `VERSION.txt`.
4. Installs the program's modules there with `npm ci`: like `npm install`, but exactly the versions in `package-lock.json`, so every location runs the same tested modules.

Setup also stops if Equipment Checkout is running on this computer: close its window first.

### Updating a location

Setup only installs into a new or empty folder, so a location is updated by installing the new version in a fresh folder and moving its records across:

1. Close the program, and get the new version of the repository on the location's computer.
2. Rename the program's folder, e.g. `C:\equipment_checkout` to `C:\equipment_checkout-old`.
3. Run setup with the original folder (`C:\equipment_checkout`) and the same location name. When it asks **Start it now?**, answer **n**.
4. Copy these from the old folder into the new one, replacing the new ones:
   - `checkouts.db`: the records.
   - `ticketList.json`: tickets not yet made into `tickets.txt`.
   - `pending-tickets.json`, if it's there: tickets still waiting to be added to the list.
   - `checkouts.xlsx`, if people added their own sheets to it. Otherwise the program makes a new one from the records.
   - `tickets.txt`, and anything else people saved in the folder, if they're still wanted.
5. Start the program and check the records are all there. The old folder can then be deleted.

### Upgrading from the first version

The database is unchanged, so the old records carry straight over: after setup, copy the old `checkouts.db` into the new folder before starting the program. (The one exception: if the `daily` table's note column is called `notes`, the program renames it `note` to match `master_log`, keeping the notes in it.)

If the first version is in the folder you want to use (e.g. `C:\equipment_checkout`), rename that folder first (e.g. to `C:\equipment_checkout-old`), as in [Updating a location](#updating-a-location). Only its `checkouts.db` is needed from it.

The old version was opened as `index.html` from a folder. The new one is opened at **http://localhost:3000**; `start.cmd` opens it for you.

If the location's old `ticketList.json` on the share still has tickets in it, turn them into tickets with the old `createTickets.ps1` first: the program now keeps its own ticket list in its folder.

## Daily use

Double-click **`start.cmd`** in the program's folder. It starts the program and opens http://localhost:3000. Keep its window open while the program is in use; closing the window stops it.

- **Checkout page** (`/`): check items out (customer, asset, location), and search and return the ones that are out. The items out are listed newest first, each card showing the customer's name with the asset, location and time below it. The asset can be anything; it's saved in capitals, and a `CSD` on the end is removed. **Return** asks to confirm first, showing the item, since a return can't be undone: Cancel, Escape or clicking outside the box leaves it checked out.
- **Admin page** (`/admin.html`): everything checked out, the full history, today's numbers, and how the Excel file and ticket list are doing.
  - **Tables** show 50 rows a page, with Prev and Next below them. The filter and sorting cover every row, not just the page shown. Sorting ignores capitals and puts numbers in order (`OPS-9` before `OPS-10`).
  - **Notes:** click the Note cell of any item, checked out or returned, to add or change its note (e.g. `charger included`, `screen cracked`). Enter or clicking elsewhere saves it, Escape cancels, and clearing the text removes it. A note on a checked-out item goes into the history when it's returned. Notes are in the Excel copy, but not in tickets.
  - **Save Excel** writes the Excel copy now.
  - **Download Excel** saves a copy to the browser's downloads folder.

Only this computer can use the program. It doesn't answer other computers, and other websites open in the browser can't use it.

## The Excel copy and the ticket list

### Excel copy (`checkouts.xlsx`)

After every checkout and return, and when the program starts, the program rebuilds the **Daily Checkouts** and **Master Log** sheets from the database. Times show as real Excel dates in this computer's local time. The header row is frozen and has filters.

- **The file is open in Excel:** Excel won't let it be replaced, so the save is retried by itself (after 2, 5, 10, 30, then every 60 seconds) until the file is closed. Because the sheets are rebuilt from the whole database each time, the next save that works brings the file fully up to date. The admin page shows when it last saved, or what's wrong.
- **Other sheets in the workbook:** kept, along with their tab order. ExcelJS can't keep charts or pivot tables, so keep those in a separate workbook that links to this one.
- **Don't rename the Daily Checkouts or Master Log tabs**, not even to change their capitals. The program finds them by name:
  - A renamed tab is left as it is, no longer updated, and a new one is added.
  - A tab with the same name in different capitals (e.g. `master log`) stops the Excel copy being saved at all, because Excel counts it as the same name. The admin page shows `Worksheet name already exists: Master Log`. Rename the tab back exactly, or delete it, and the next save works.
- **The file can't be read** (no permission): it's never overwritten; the save just waits.
- **The file isn't a workbook at all** (damaged): it's renamed to `checkouts-unreadable-<date>.xlsx`, so nothing in it is lost, and a new one is started.

### Ticket list (`ticketList.json`)

Every return adds a ticket:

```json
{ "asset": "OPS-1234", "checkout": "2026-11-17T14:00:00.000Z", "return": "2026-11-17T19:05:00.000Z",
  "user": "Jane Doe", "location": "Courtroom 3", "rso": "", "status": "Returned", "id": "…" }
```

Each ticket is saved in `pending-tickets.json` first and then added to the list. If the list can't be changed yet, tickets wait safely, even through a restart. If `ticketList.json` isn't valid JSON (e.g. after editing it by hand), it's never overwritten: the admin page says so, and the tickets are added once it's fixed (or emptied to `[]`).

### Making tickets (`createTickets.ps1`)

RSOs right-click `createTickets.ps1` in the program's folder and choose **Run with PowerShell**. It asks to confirm, asks for their name, and writes every ticket to `tickets.txt` in the same format as before, then empties the list. Make sure the tickets in the old `tickets.txt` have been filed first.

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
    "location": "46 Water Street"
}
```

`location` is shown at the top of the pages. Without `config.json` the program still runs; it just shows no location.

## Utilities

- **`npm run clear-db`**: VERY DANGEROUS. Deletes every record, both checked out and history. Stop the program first. It saves a copy as `checkouts-before-clear-<date>.db`, and only goes ahead if you type `CLEAR`.

## For developers

```
server.js            starts the program (reads config.json, opens the database, listens on 127.0.0.1:3000)
lib/app.js           the web server: pages, API, security checks
lib/database.js      checkouts.db (the tables are exactly the first version's)
lib/excel.js         the Excel copy
lib/tickets.js       the ticket list and its local queue
lib/background.js    retries writes until they work (the Excel file open in Excel, the ticket list in use)
lib/files.js         safe file writes and the lock file
lib/config.js        reads config.json
public/              the two pages (plain HTML, CSS and JavaScript modules)
deploy/              setup.ps1, and createTickets.ps1 (which setup copies into the program's folder)
scripts/clear-db.js
test/                tests (node:test)
```

The only dependency is [ExcelJS](https://github.com/exceljs/exceljs). The database is Node's built-in `node:sqlite`, and the server is Node's built-in `http`. `package.json` pins patched versions of a few of ExcelJS's own dependencies (`overrides`); `npm audit` should report 0 vulnerabilities.

Run the tests with `npm test`. The browser tests use Chrome, Chromium or Edge if one is installed, and are skipped otherwise.

To try the program, run `npm start` in the repository. It keeps its records, Excel file and ticket list in the repository folder (git ignores them).

### API

All replies are JSON (except the download). Changes must be sent as JSON from the program's own pages.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/checkouts` | Items checked out now, most recently checked out first |
| POST | `/api/checkouts` | Check out `{ name, asset, location }` |
| POST | `/api/checkouts/:id/return` | Return an item: moves it to the history and adds a ticket |
| POST | `/api/checkouts/:id/note` | Set `{ note }` on an item, checked out or returned (`""` removes it) |
| GET | `/api/history` | Every returned item, most recent first |
| GET | `/api/status` | The location, and how the Excel copy and ticket list are doing |
| POST | `/api/excel/save` | Write the Excel copy now |
| GET | `/api/export` | Download the records as an Excel file |
