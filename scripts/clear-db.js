// DANGEROUS: deletes every record, both what's checked out (daily) and the full history
// (master_log). A copy of the database is saved first, as checkouts-before-clear-<date>.db.
//
// Run with:  npm run clear-db
// Stop the checkout program first.

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { openDatabase } from '../lib/database.js';

const HOME = process.env.CHECKOUT_HOME || join(import.meta.dirname, '..');
const DB_FILE = join(HOME, 'checkouts.db');

if (!existsSync(DB_FILE)) {
  console.error(`There is no database at ${DB_FILE}, so there is nothing to clear.`);
  process.exit(1);
}

const store = openDatabase(DB_FILE);
const out = store.checkedOut().length;
const history = store.history().length;
console.log(`${DB_FILE} has ${out} checked-out item(s) and ${history} history record(s).`);
console.log('This deletes ALL of them. Make sure the checkout program is stopped first.');

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question('Type CLEAR to delete everything, or anything else to stop: ');
prompt.close();
if (answer.trim() !== 'CLEAR') {
  console.log('Stopped. Nothing was deleted.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
const backup = join(HOME, `checkouts-before-clear-${stamp}.db`);
store.close();
copyFileSync(DB_FILE, backup);
console.log(`Saved a copy of the database as ${backup}`);

const cleared = openDatabase(DB_FILE);
cleared.db.exec('BEGIN; DELETE FROM daily; DELETE FROM master_log; COMMIT;');
cleared.close();
console.log('All records were deleted. The Excel copy will be emptied the next time the checkout program starts.');
