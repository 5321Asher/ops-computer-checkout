import Database from "better-sqlite3"; //DB

const db = new Database("checkouts.db"); //use checkouts.db file in ./

//db.prepare("delete from master_log").run(); //clear master_log
//db.prepare("delete from daily").run(); //clear daily
