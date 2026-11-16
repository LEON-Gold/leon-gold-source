// node admin.mjs user <name> <password>   set a login's password (signs its devices out). Only SETUP_USER, the owner, can sign in to the ledger.
// node admin.mjs backup                   write today's database copy into DATA_DIR/backups now
// node admin.mjs state                    how much is stored
import { db, setUser, backup } from "./server.mjs";
const [cmd, a, b] = process.argv.slice(2);
if (cmd === "user" && a && b) { setUser(a, b); console.log("saved user", a); }
else if (cmd === "backup") console.log(backup() || "today's backup already exists");
else if (cmd === "state") console.log({
  docs: db.prepare("SELECT col, count(*) AS n FROM docs WHERE data IS NOT NULL GROUP BY col").all(),
  blobs: db.prepare("SELECT count(*) AS n FROM blobs").get().n,
  users: db.prepare("SELECT name FROM users").all().map(u => u.name),
  sessions: db.prepare("SELECT user, device, seen FROM sessions").all(),
});
else { console.log("usage: node admin.mjs user <name> <password> | backup | state"); process.exit(1); }
