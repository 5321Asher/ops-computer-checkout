# Equipment Checkout V2
###### By: Asher Virgona

Check equipment in and out at a location. Each location runs the program on one computer, which keeps the records there in a SQLite database (`checkouts.db`), so it works even when the network is down.

It also keeps three files in the location's folder on the server, which is everything the RSOs need:

- **`checkouts.xlsx`**: an Excel copy of every record, updated after every change.
- **`ticketList.json`**: a ticket for every returned item.
- **`createTickets.ps1`**: RSOs run it to turn the ticket list into `tickets.txt`.

## How it's laid out

```
C:\equipment_checkout\          this repository, cloned onto the location's computer
  setup.ps1                     run once after cloning
  start.cmd                     starts the program
  config.json                   the location's name and server folder (setup.ps1 writes it)
  checkouts.db                  the records
  pending-tickets.json          tickets waiting to be added to the ticket list on the server
  server.js, lib\, public\, ... the program itself

\\jus00adc1140\library\Scripts\equipment_checkout_v2\46-water-street\
                                the location's server folder
  checkouts.xlsx                the Excel copy
  ticketList.json               tickets waiting to be made
  createTickets.ps1             RSOs run this to make tickets.txt
  tickets.txt                   the last tickets made (createTickets.ps1 writes it)
```

The program puts the three files in the server folder itself, so there's nothing to copy to the server by hand. Each location needs its own server folder: two locations sharing one would overwrite each other's Excel copy.

## What you need

On the location's computer:

- [Node.js](https://nodejs.org), version 22.13 or newer (the current LTS is best; npm comes with it).
- Git, to clone the repository (or download the ZIP from GitHub and unzip it).
- Global Connect during setup, so npm can download the program's modules. After that, the program runs without it; it just can't update the server folder until the server can be reached.

## Setting up a location

1. Clone the repository onto the location's computer:
   ```
   git clone https://github.com/5321Asher/ops-computer-checkout.git C:\equipment_checkout
   ```
2. Connect to Global Connect, then right-click **`setup.ps1`** in that folder and choose **Run with PowerShell**. It asks for:
   - the location's name, e.g. `46 Water Street`, shown at the top of the pages;
   - the location's server folder, e.g. `\\jus00adc1140\library\Scripts\equipment_checkout_v2\46-water-street`. Use the full `\\server\share\...` path, so it works even where the share isn't mapped to a drive letter. If the folder doesn't exist yet, setup offers to create it.

   It saves both in `config.json`, then installs the program's modules with `npm ci` (like `npm install`, but exactly the versions in `package-lock.json`).
3. Start it: double-click **`start.cmd`**, or run `npm start` in the folder.

Run setup again any time to change the name or the server folder. It never touches the records.

### Updating a location

Close the program, then in its folder:

```
git pull
```

Run `setup.ps1` again (press Enter to keep each answer) to update the modules, then start the program. The records, `config.json` and the tickets waiting to be sent are never in git, so a pull never touches them. When the program starts, it replaces `createTickets.ps1` on the server with the new version.

### Upgrading from the first version

The database is unchanged, so the old records carry straight over: after setup, copy the old `checkouts.db` into the program's folder before starting the program. (The one exception: if the `daily` table's note column is called `notes`, the program renames it `note` to match `master_log`, keeping the notes in it.)

The first version kept its files on the share in `\\jus00adc1140\library\Scripts\equipment_checkout_v2\`. Either:

- **Use that folder as the location's server folder** (only one location can). The tickets already in its `ticketList.json` are kept, the Excel copy's two record sheets are rebuilt (any other sheets are kept), and `createTickets.ps1` is replaced with the new one, which writes `tickets.txt` in the same format.
- **Or use a new folder.** First turn any tickets left in the old `ticketList.json` into tickets with the old `createTickets.ps1`.

The old version was opened as `index.html` from a folder. The new one is opened at **http://localhost:3000**; `start.cmd` opens it for you.

## Daily use

Double-click **`start.cmd`** in the program's folder. It starts the program and opens http://localhost:3000. Keep its window open while the program is in use; closing the window stops it.

- **Checkout page** (`/`): check items out (customer, asset, location), and search and return the ones that are out. The items out are listed newest first, each card showing the customer's name with the asset, location and time below it. The asset can be anything; it's saved in capitals, and a `CSD` on the end is removed. **Return** asks to confirm first, showing the item, since a return can't be undone: Cancel, Escape or clicking outside the box leaves it checked out.
- **Admin page** (`/admin.html`): everything checked out, the full history, today's numbers, and how the Excel file and ticket list on the server are doing.
  - **Tables** show 50 rows a page, with Prev and Next below them. The filter and sorting cover every row, not just the page shown. Sorting ignores capitals and puts numbers in order (`OPS-9` before `OPS-10`).
  - **Notes:** click the Note cell of any item, checked out or returned, to add or change its note (e.g. `charger included`, `screen cracked`). Enter or clicking elsewhere saves it, Escape cancels, and clearing the text removes it. A note on a checked-out item goes into the history when it's returned. Notes are in the Excel copy, but not in tickets.
  - **Save Excel** writes the Excel copy to the server now.
  - **Download Excel** saves a copy to the browser's downloads folder.

Only this computer can use the program. It doesn't answer other computers, and other websites open in the browser can't use it.

## The files on the server

When the server can't be reached, nothing is lost: checkouts and returns carry on as normal, and the program keeps trying (after 2, 5, 10, 30, then every 60 seconds) until the server is back. The admin page shows what's waiting, and why.

### Excel copy (`checkouts.xlsx`)

After every checkout and return, and when the program starts, the program rebuilds the **Daily Checkouts** and **Master Log** sheets from the database. Times show as real Excel dates in this computer's local time. The header row is frozen and has filters.

- **The file is open in Excel, or the server is down:** the save is retried by itself until it works. Because the sheets are rebuilt from the whole database each time, the next save that works brings the file fully up to date. The admin page shows when it last saved, or what's wrong.
- **Other sheets in the workbook:** kept, along with their tab order. ExcelJS can't keep charts or pivot tables, so keep those in a separate workbook that links to this one.
- **Don't rename the Daily Checkouts or Master Log tabs**, not even to change their capitals. The program finds them by name:
  - A renamed tab is left as it is, no longer updated, and a new one is added.
  - A tab with the same name in different capitals (e.g. `master log`) stops the Excel copy being saved at all, because Excel counts it as the same name. The admin page shows `Worksheet name already exists: Master Log`. Rename the tab back exactly, or delete it, and the next save works.
- **The file can't be read** (server down, no permission): it's never overwritten; the save just waits.
- **The file isn't a workbook at all** (damaged): it's renamed to `checkouts-unreadable-<date>.xlsx`, so nothing in it is lost, and a new one is started.

### Ticket list (`ticketList.json`)

Every return adds a ticket:

```json
{ "asset": "OPS-1234", "checkout": "2026-11-17T14:00:00.000Z", "return": "2026-11-17T19:05:00.000Z",
  "user": "Jane Doe", "location": "Courtroom 3", "rso": "", "status": "Returned", "id": "…" }
```

Each ticket is saved on the computer first (`pending-tickets.json`) and then added to the list on the server. If the list can't be changed yet (the server is down, or `createTickets.ps1` is using it), tickets wait safely, even through a restart. If `ticketList.json` isn't valid JSON (e.g. after editing it by hand), it's never overwritten: the admin page says so, and the tickets are added once it's fixed (or emptied to `[]`).

### Making tickets (`createTickets.ps1`)

RSOs right-click `createTickets.ps1` in the location's server folder and choose **Run with PowerShell**. It asks to confirm, asks for their name, and writes every ticket to `tickets.txt` next to it, in the same format as before, then empties the list. Make sure the tickets in the old `tickets.txt` have been filed first.

```
Please assign ticket to JC -> MAG DISTRIBUTED SUPPORT -> JUS MAG CS RSO TORONTO -> <RSO name>.
Machine Name: OPS-1234
Courtroom: Courtroom 3
DESCRIPTION: Client Jane Doe requested equipment at 2026-11-17 9:00 AM
Resolution: Equipment returned at 2026-11-17 2:05 PM
```

Times are local, and the same on every PowerShell version. The program and the script take turns with the list using a lock file (`ticketList.json.lock`, there only for the moment either one is changing the list), so a return made while the script runs is never lost. A lock left over from a crash is cleared after 2 minutes.

The program copies `createTickets.ps1` from its own folder to the server each time it starts, replacing the server's copy if it's different. To change the script, change it in the repository, not on the server.

## Settings (`config.json`)

`setup.ps1` writes `config.json` in the program's folder:

```json
{
    "location": "46 Water Street",
    "serverFolder": "\\\\jus00adc1140\\library\\Scripts\\equipment_checkout_v2\\46-water-street"
}
```

- `location` is shown at the top of the pages.
- `serverFolder` is where the Excel copy, ticket list and `createTickets.ps1` go. In JSON, each `\` is written `\\`.

Without `serverFolder` (or without `config.json`) the program still runs, but keeps those three files in its own folder; the window says so when it starts. That's handy for trying the program out.

## Utilities

- **`npm run clear-db`**: VERY DANGEROUS. Deletes every record, both checked out and history. Stop the program first. It saves a copy as `checkouts-before-clear-<date>.db`, and only goes ahead if you type `CLEAR`.

## For developers

```
server.js            starts the program (reads config.json, opens the database, listens on 127.0.0.1:3000)
lib/app.js           the web server: pages, API, security checks
lib/database.js      checkouts.db (the tables are exactly the first version's)
lib/excel.js         the Excel copy
lib/tickets.js       the ticket list and its local queue
lib/background.js    retries writes to the server folder until they work
lib/files.js         safe file writes and the lock file
lib/config.js        reads config.json
public/              the two pages (plain HTML, CSS and JavaScript modules)
setup.ps1            sets up a location
createTickets.ps1    the program copies it to the server folder
scripts/clear-db.js
test/                tests (node:test)
```

The only dependency is [ExcelJS](https://github.com/exceljs/exceljs). The database is Node's built-in `node:sqlite`, and the server is Node's built-in `http`. `package.json` pins patched versions of a few of ExcelJS's own dependencies (`overrides`); `npm audit` should report 0 vulnerabilities.

Run the tests with `npm test`. The browser tests use Chrome, Chromium or Edge if one is installed, and are skipped otherwise.

To try the program, run `npm start` in the repository without a `config.json`. It keeps everything in the repository folder (git ignores the records, the Excel file and the ticket list).

### API

All replies are JSON (except the download). Changes must be sent as JSON from the program's own pages.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/checkouts` | Items checked out now, most recently checked out first |
| POST | `/api/checkouts` | Check out `{ name, asset, location }` |
| POST | `/api/checkouts/:id/return` | Return an item: moves it to the history and adds a ticket |
| POST | `/api/checkouts/:id/note` | Set `{ note }` on an item, checked out or returned (`""` removes it) |
| GET | `/api/history` | Every returned item, most recent first |
| GET | `/api/status` | The location, the server folder, and how the Excel copy and ticket list are doing |
| POST | `/api/excel/save` | Write the Excel copy now |
| GET | `/api/export` | Download the records as an Excel file |
