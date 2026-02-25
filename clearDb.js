import Database from "better-sqlite3";

const db = new Database("checkouts.db");

db.prepare("delete from master_log").run();
db.prepare("delete from daily").run();
