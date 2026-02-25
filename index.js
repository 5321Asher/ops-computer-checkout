import Database from "better-sqlite3";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { readFileSync, writeFileSync } from "fs";

const app = express();
app.use(cors());
const db = new Database("checkouts.db");

/*
Root Route. simply sends a working message
*/
app.get("/", (req, res) => {
    res.status(200).send("Checkout API running");
});

/*
this Route adds a new entry

URL Fields:
:user = the customer name
:asset = asset name
:location = location input

other DB Fields:
checkout = date and time at INSERT
return = null as this is the checkout Route
id = unique generated Id for each entry (safer)

constraints:
- user, asset, and location cannot be null
- asset must be in the format ops-[asset_number]
*/
app.post("/checkout/:user/:asset/:location", (req, res) => {
    const { user, location } = req.params;
    let asset = req.params.asset;

    // null safety
    if (!user || !asset || !location) {
        res.status(400).send("Please fill out all fields.");
        return;
    }

    // trim the asset to remove any whitespace
    asset = asset.trim();

    // corrected operator precedence — was using || inside startsWith()
    if (!asset.startsWith("OPS-") && !asset.startsWith("ops-")) {
        res.status(400).send("Asset must start with 'OPS-' or 'ops-' prefix.");
        return;
    }

    // removes csd at the end of the asset if they added it
    if (asset.slice(-3).toLowerCase() === "csd") {
        asset = asset.slice(0, -3);
    }

    // removes any other whitespace after csd was removed
    asset = asset.trim();

    db.prepare(
        `INSERT INTO daily (name, asset, location, checkout, returned_at, id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(user, asset, location, new Date().toISOString(), null, uuidv4());

    res.status(200).send(asset + " Asset Checked Out Successfully");
});

app.get("/masterlog", (req, res) => {
    try {
        const rows = db
            .prepare(`SELECT * FROM master_log ORDER BY returned_at DESC`)
            .all();
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).send("Failed to fetch master log");
    }
});

/*
this Route updates the entry at :id to make return the current time
URL variables:
:id = the id of the checkout entry

constraints:
- :id must not be null
*/
app.post("/checkin/:id", (req, res) => {
    let id = req.params.id;

    // null safety
    if (!id) {
        res.status(400).send("Checkout entry blank.");
        return;
    }

    id = id.trim();

    // validate entry exists before proceeding
    const entry = db.prepare(`SELECT * FROM daily WHERE id = ?`).get(id);
    if (!entry) {
        res.status(404).send("Checkout entry not found.");
        return;
    }

    const returnTime = new Date().toISOString();

    // wrap insert + delete in a transaction so they're atomic
    const checkin = db.transaction(() => {
        db.prepare(`UPDATE daily SET "returned_at" = ? WHERE id = ?`).run(
            returnTime,
            id,
        );

        // use .get() instead of .run().json()
        const updated = db.prepare(`SELECT * FROM daily WHERE id = ?`).get(id);

        // moves entry to master_log
        db.prepare(
            `INSERT INTO master_log (id, asset, checkout, returned_at, name, location, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            updated.id,
            updated.asset,
            updated.checkout,
            updated.returned_at,
            updated.name,
            updated.location,
            updated.notes ?? null, // notes may not exist in daily, default to null
        );

        db.prepare(`DELETE FROM daily WHERE id = ?`).run(id);

        return updated;
    });

    const updated = checkin();

    // read ticketList fresh from disk, mutate, then write back for persistence
    const ticketListPath = "./ticketList.json";
    const ticketList = JSON.parse(readFileSync(ticketListPath, "utf-8"));

    const newTicket = {
        asset: updated.asset,
        checkout: updated.checkout,
        return: updated.returned_at,
        user: updated.name,
        location: updated.location,
        rso: "",
        status: "Returned",
    };

    ticketList.push(newTicket);
    writeFileSync(ticketListPath, JSON.stringify(ticketList, null, 2));

    res.status(200).send("Asset Returned Successfully");
});

/*
this Route returns all entries in the daily table where return = null (currently checked out assets)
*/
app.get("/checkedout", (req, res) => {
    try {
        const rows = db
            .prepare(`SELECT * FROM daily WHERE returned_at IS NULL`)
            .all();
        res.status(200).json(rows);
    } catch (err) {
        res.status(400).send("Failed to fetch data");
    }
});

/*
 * GET /export
 * Exports both the `daily` and `master_log` tables from checkouts.db
 * as separate sheets in a single Excel (.xlsx) file, then streams it
 * to the client as a download.
 *
 * No URL parameters required.
 */
app.get("/export", (req, res) => {
    // Dynamically import exceljs so it doesn't affect startup if not installed
    import("exceljs")
        .then((ExcelJS) => {
            const wb = new ExcelJS.default.Workbook();

            // --- Sheet 1: Currently checked out (daily table) ---
            const dailyRows = db.prepare(`SELECT * FROM daily`).all();
            const dailySheet = wb.addWorksheet("Daily Checkouts");

            if (dailyRows.length > 0) {
                // Use the DB column names as headers
                dailySheet.columns = Object.keys(dailyRows[0]).map((key) => ({
                    header: key,
                    key: key,
                    width: 24,
                }));
                dailyRows.forEach((row) => dailySheet.addRow(row));
            }

            // Style header row bold
            dailySheet.getRow(1).font = { bold: true };

            // --- Sheet 2: Full history (master_log table) ---
            const logRows = db.prepare(`SELECT * FROM master_log`).all();
            const logSheet = wb.addWorksheet("Master Log");

            if (logRows.length > 0) {
                logSheet.columns = Object.keys(logRows[0]).map((key) => ({
                    header: key,
                    key: key,
                    width: 24,
                }));
                logRows.forEach((row) => logSheet.addRow(row));
            }

            logSheet.getRow(1).font = { bold: true };

            // --- Stream the workbook to the client as a download ---
            const filename = `checkouts_${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            );
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`,
            );

            wb.xlsx.write(res).then(() => res.end());
        })
        .catch((err) => {
            res.status(500).send("Failed to generate export: " + err.message);
        });
});

/*
 * GET /export/save
 * Same as /export but writes the .xlsx file to the project root directory
 * instead of streaming it to the client.
 *
 * No URL parameters required.
 */
app.get("/export/save", (req, res) => {
    import("exceljs")
        .then(async (ExcelJS) => {
            const wb = new ExcelJS.default.Workbook();

            // --- Sheet 1: Currently checked out (daily table) ---
            const dailyRows = db.prepare(`SELECT * FROM daily`).all();
            const dailySheet = wb.addWorksheet("Daily Checkouts");

            if (dailyRows.length > 0) {
                dailySheet.columns = Object.keys(dailyRows[0]).map((key) => ({
                    header: key,
                    key: key,
                    width: 24,
                }));
                dailyRows.forEach((row) => dailySheet.addRow(row));
            }

            dailySheet.getRow(1).font = { bold: true };

            // --- Sheet 2: Full history (master_log table) ---
            const logRows = db.prepare(`SELECT * FROM master_log`).all();
            const logSheet = wb.addWorksheet("Master Log");

            if (logRows.length > 0) {
                logSheet.columns = Object.keys(logRows[0]).map((key) => ({
                    header: key,
                    key: key,
                    width: 24,
                }));
                logRows.forEach((row) => logSheet.addRow(row));
            }

            logSheet.getRow(1).font = { bold: true };

            // --- Write file to project root ---
            const filename = `checkouts_${new Date().toISOString().slice(0, 10)}.xlsx`;
            const filepath = new URL(filename, import.meta.url).pathname;

            await wb.xlsx.writeFile(filepath);

            res.status(200).send(`Export saved to ${filepath}`);
        })
        .catch((err) => {
            res.status(500).send("Failed to save export: " + err.message);
        });
});

app.listen(3000, () => {
    console.log("Server started on port 3000");
});
