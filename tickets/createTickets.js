#!/usr/bin/env node

import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";

// ESM equivalent of __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// File paths
const INPUT_FILE = path.join(__dirname, "ticketList.json");
const OUTPUT_FILE = path.join(__dirname, "tickets.txt");

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Helper: promisify rl.question for cleaner async usage
function ask(question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
    // --- Step 1: Warn the user about overwrite ---
    const overwriteAnswer = await ask(
        "This will overwrite the current tickets.txt. Continue? (y/n): ",
    );

    if (overwriteAnswer.trim().toLowerCase() !== "y") {
        console.log("Aborted.");
        rl.close();
        return;
    }

    // --- Step 2: Ask for RSO name ---
    const rsoName = await ask("What is your name? ");

    if (!rsoName.trim()) {
        console.log("No name entered. Aborted.");
        rl.close();
        return;
    }

    // --- Step 3: Read ticketList.json ---
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: Could not find ${INPUT_FILE}`);
        rl.close();
        return;
    }

    let tickets;
    try {
        const raw = fs.readFileSync(INPUT_FILE, "utf-8");
        tickets = JSON.parse(raw);
    } catch (err) {
        console.error("Error reading or parsing ticketList.json:", err.message);
        rl.close();
        return;
    }

    if (!Array.isArray(tickets) || tickets.length === 0) {
        console.log("No tickets found in ticketList.json.");
        rl.close();
        return;
    }

    // --- Step 4: Build the output string for each ticket ---
    const lines = tickets.map((ticket) => {
        // Fill in the RSO field with the provided name
        const rso = rsoName.trim();

        return [
            `Please assign ticket to JC -> MAG DISTRIBUTED SUPPORT -> JUS MAG CS RSO TORONTO -> ${rso}.`,
            `Machine Name: ${ticket.asset}`,
            `Courtroom: ${ticket.location}`,
            `DESCRIPTION: Client ${ticket.user} requested equipment at ${ticket.checkout}`,
            `Resolution: Equipment returned at ${ticket.return}`,
        ].join("\n");
    });

    // Join all tickets with a blank line between each
    const output = lines.join("\n\n");

    // --- Step 5: Write to tickets.txt ---
    try {
        fs.writeFileSync(OUTPUT_FILE, output, "utf-8");
        console.log(
            `\nDone! ${tickets.length} ticket(s) written to tickets.txt using RSO name: "${rsoName.trim()}"`,
        );
    } catch (err) {
        console.error("Error writing tickets.txt:", err.message);
    }

    rl.close();
}

main();
