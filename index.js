import Database from "better-sqlite3"; //Database Library
import express from "express"; //API Creation
import cors from "cors"; //boilerplate
import { v4 as uuidv4 } from "uuid"; //Create UUID for items
import { readFileSync, writeFileSync, existsSync } from "fs"; //Allow Filesystem Access

const app = express();
app.use(cors()); //make express use cors
const db = new Database("checkouts.db"); //checkouts.db is a sqlite db file in ./

const EXCEL_PATH = "Z:\\Scripts\\equipment_checkout_v2\\checkouts.xlsx"; //path to excel hard copy on server \\jus00adc1140\library
const TICKET_LIST_PATH = "Z:\\Scripts\\equipment_checkout_v2\\ticketList.json";


/*
 * Syncs the current DB state to the Excel file.
 * - If the file doesn't exist, creates it fresh.
 * - If it does exist, opens it and rewrites only the Daily Checkouts
 *   and Master Log sheets, preserving any other sheets.
 */
async function syncExcel() {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.default.Workbook();

    // Load existing workbook if it exists, otherwise start fresh
    if (existsSync(EXCEL_PATH)) {
        try {
            await wb.xlsx.readFile(EXCEL_PATH);
        } catch {
            // File may be corrupt, start fresh
        }
    }

    // Helper: clear and repopulate a sheet by name
    function syncSheet(sheetName, rows) {
        // Remove existing sheet if present
        const existing = wb.getWorksheet(sheetName);
        if (existing) wb.removeWorksheet(existing.id);

        const sheet = wb.addWorksheet(sheetName);
        if (rows.length > 0) {
            sheet.columns = Object.keys(rows[0]).map((key) => ({
                header: key,
                key: key,
                width: 24,
            }));
            rows.forEach((row) => sheet.addRow(row));
        }
        sheet.getRow(1).font = { bold: true };
    }

    syncSheet("Daily Checkouts", db.prepare(`SELECT * FROM daily`).all());
    syncSheet("Master Log", db.prepare(`SELECT * FROM master_log ORDER BY returned_at DESC`).all());

    await wb.xlsx.writeFile(EXCEL_PATH);
}

/*
 * Wraps syncExcel with retry logic in case the file is briefly locked.
 */
async function syncExcelWithRetry(retries = 5, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            await syncExcel();
            return;
        } catch (err) {
            if (err.code === "EBUSY" && i < retries - 1) {
                console.warn(`Excel file busy, retrying in ${delayMs}ms... (${i + 1}/${retries})`);
                await new Promise((r) => setTimeout(r, delayMs));
            } else {
                console.error("Failed to sync Excel:", err.message);
                return; // Don't crash the server over a backup failure
            }
        }
    }
}

app.get("/", (req, res) => {
    res.status(200).send("Checkout API running");
});

/*
 * POST /checkout/:user/:asset/:location
 * Checks out an asset — inserts into DB then syncs Excel.
 */
app.post("/checkout/:user/:asset/:location", (req, res) => {
    //get params from URL
    const { user, location } = req.params;
    let asset = req.params.asset;

    if (!user || !asset || !location) {
        res.status(400).send("Please fill out all fields.");
        return;
    }

    asset = asset.trim(); //remove trailing whitespace

    //make sure asset string starts with ops- or OPS-
    if (!asset.startsWith("OPS-") && !asset.startsWith("ops-")) {
        res.status(400).send("Asset must start with 'OPS-' or 'ops-' prefix.");
        return;
    }

    //remove CSD tag after asset string if user inputted it
    if (asset.slice(-3).toLowerCase() === "csd") {
        asset = asset.slice(0, -3);
    }

    asset = asset.trim(); //remove trailing whitespace

    //insert into daily checkouts
    db.prepare(
        `INSERT INTO daily (name, asset, location, checkout, returned_at, id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(user, asset, location, new Date().toISOString(), null, uuidv4());

    // Respond immediately, sync Excel in the background
    res.status(200).send(asset + " Asset Checked Out Successfully");
    syncExcelWithRetry();
});

/*
 * POST /checkin/:id
 * Checks in an asset — updates DB, moves to master_log, syncs Excel.
 */
app.post("/checkin/:id", (req, res) => {
    let id = req.params.id; //get params from URL

    //id cannot be null
    if (!id) {
        res.status(400).send("Checkout entry blank.");
        return;
    }

    id = id.trim(); //remove trailing whitespace

    //find item in DB
    const entry = db.prepare(`SELECT * FROM daily WHERE id = ?`).get(id);
    if (!entry) {
        res.status(404).send("Checkout entry not found.");
        return;
    }

    const returnTime = new Date().toISOString(); //current time

    //change return feild to curren time
    const checkin = db.transaction(() => {
        db.prepare(`UPDATE daily SET "returned_at" = ? WHERE id = ?`).run(returnTime, id);

        const updated = db.prepare(`SELECT * FROM daily WHERE id = ?`).get(id);

        //insert item from daily to master_log
        db.prepare(
            `INSERT INTO master_log (id, asset, checkout, returned_at, name, location, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            updated.id,
            updated.asset,
            updated.checkout,
            updated.returned_at,
            updated.name,
            updated.location,
            updated.notes ?? null,
        );
        //delete item from daily (move to master_log)
        db.prepare(`DELETE FROM daily WHERE id = ?`).run(id);

        return updated;
    });

    const updated = checkin(); //actually call the transaction above

    // Update ticket list
    const ticketListPath = TICKET_LIST_PATH;
    const ticketList = JSON.parse(readFileSync(ticketListPath, "utf-8"));
    ticketList.push({
        asset: updated.asset,
        checkout: updated.checkout,
        return: updated.returned_at,
        user: updated.name,
        location: updated.location,
        rso: "",
        status: "Returned",
    });
    writeFileSync(ticketListPath, JSON.stringify(ticketList, null, 2));

    //sync excel in background
    res.status(200).send("Asset Returned Successfully");
    syncExcelWithRetry();
});

/*
returns all items in daily table
*/
app.get("/checkedout", (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM daily WHERE returned_at IS NULL`).all();
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).send("Failed to fetch data");
    }
});

/*
returns all items in master_log
*/
app.get("/masterlog", (req, res) => {
    try {
        const rows = db.prepare(`SELECT * FROM master_log ORDER BY returned_at DESC`).all();
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).send("Failed to fetch master log");
    }
});

/*
 * GET /export/save
 * Manually triggers a sync of the DB state to the network Excel file.
 */
app.get("/export/save", async (req, res) => {
    try {
        await syncExcel();
        res.status(200).send(`Export saved to ${EXCEL_PATH}`);
    } catch (err) {
        res.status(500).send("Failed to save export: " + err.message);
    }
});

app.listen(3000, () => {
    console.log("Server started on port 3000");
});
