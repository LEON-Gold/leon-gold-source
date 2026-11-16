// Off-site backups of the sync server, kept on the owner's PC (outside every git repo).
//   node tools/backup.mjs login                      ask for the owner's username and password once; keeps only a token, in ~/.leon-backup.json
//   node tools/backup.mjs pull                       download today's copy into LEON PROJECT\backups, check it, keep the last 60
//   node tools/backup.mjs check <file>               open a copy and count what is in it
//   node tools/backup.mjs restore <file> --to <url> --yes
//                                                    put the server at <url> back to exactly what the copy holds, through the normal API
//                                                    (every document and photo; documents the copy does not have are deleted). Try it on a
//                                                    local throwaway server first (DATA_DIR=<temp> node server.mjs).
// Env: LEON_SERVER (default https://api.leongold.net), LEON_BACKUP_DIR, LEON_BACKUP_TOKEN (instead of the login file).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";

const SERVER = (process.env.LEON_SERVER || "https://api.leongold.net").replace(/\/$/, "");
const DIR = path.resolve(process.env.LEON_BACKUP_DIR || path.join(import.meta.dirname, "..", "..", "backups"));
const KEEP = 60, TOKEN_FILE = path.join(os.homedir(), ".leon-backup.json");

export function check(file) {
  const c = new DatabaseSync(file, { readOnly: true });
  try {
    const ok = c.prepare("PRAGMA integrity_check").get().integrity_check;
    if (ok !== "ok") throw new Error("damaged copy: " + ok);
    return {
      ok: true,
      rev: +(c.prepare("SELECT v FROM meta WHERE k='rev'").get()?.v || 0),
      docs: Object.fromEntries(c.prepare("SELECT col, count(*) AS n FROM docs WHERE data IS NOT NULL GROUP BY col").all().map(r => [r.col, r.n])),
      photos: c.prepare("SELECT count(*) AS n FROM blobs").get().n,
    };
  } finally { c.close(); }
}

const token = () => process.env.LEON_BACKUP_TOKEN || JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")).token;

export async function pull({ server = SERVER, dir = DIR, auth = token() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const r = await fetch(server + "/api/backup", { headers: { Authorization: "Bearer " + auth }, signal: AbortSignal.timeout(10 * 60e3) });
  if (r.status === 401) throw new Error("the backup login has expired: run  node tools/backup.mjs login  again");
  if (!r.ok) throw new Error("server answered " + r.status);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"), tmp = path.join(dir, `.leon-${stamp}.part`), f = path.join(dir, `leon-${stamp}.db`);
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  let info;
  try { info = check(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  fs.renameSync(tmp, f);
  fs.readdirSync(dir).filter(n => /^leon-.*\.db$/.test(n)).sort().slice(0, -KEEP).forEach(n => fs.unlinkSync(path.join(dir, n)));
  return { file: f, ...info };
}

export async function restore(file, { server, auth }) {
  check(file);
  const c = new DatabaseSync(file, { readOnly: true }), call = async (p, o = {}) => {
    const r = await fetch(server + p, { ...o, headers: { Authorization: "Bearer " + auth, ...o.headers } });
    if (!r.ok) throw new Error(p + " → " + r.status);
    return r;
  };
  try {
    // what the server holds now, so documents the copy does not have can be deleted
    const now = new Set(), key = (col, id) => col + "\u0000" + id;
    for (let since = 0, more = true; more;) {
      const p = await (await call("/api/pull?since=" + since)).json();
      for (const ch of p.changes) ch.d == null ? now.delete(key(ch.c, ch.id)) : now.add(key(ch.c, ch.id));
      since = p.rev; more = p.more;
    }
    const keep = c.prepare("SELECT col, id, data FROM docs WHERE data IS NOT NULL").all();
    const changes = keep.map(r => ({ c: r.col, id: r.id, d: JSON.parse(r.data) }));
    for (const r of keep) now.delete(key(r.col, r.id));
    for (const k of now) { const [col, id] = k.split("\u0000"); changes.push({ c: col, id, d: null }); }
    for (let i = 0; i < changes.length; i += 500)
      await call("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes: changes.slice(i, i + 500) }) });
    let photos = 0;
    for (const b of c.prepare("SELECT id, type, bytes FROM blobs").iterate()) {
      await call("/api/blob/" + encodeURIComponent(b.id), { method: "PUT", headers: { "Content-Type": b.type }, body: Buffer.from(b.bytes) }); photos++;
    }
    return { written: keep.length, deleted: changes.length - keep.length, photos };
  } finally { c.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "login") {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const u = await rl.question("username: "), p = await rl.question("password: "); rl.close();
      const r = await fetch(SERVER + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u, p, device: "backup (" + os.hostname() + ")" }) });
      const j = await r.json(); if (!j.token) throw new Error("login refused: " + (j.error || r.status));
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({ server: SERVER, token: j.token }), { mode: 0o600 });
      console.log("saved; the password itself is not kept");
    } else if (cmd === "pull") console.log(await pull());
    else if (cmd === "check" && file) console.log(check(file));
    else if (cmd === "restore" && file) {
      const to = rest[rest.indexOf("--to") + 1];
      if (!rest.includes("--to") || !to) throw new Error("say which server: --to <url>");
      if (!rest.includes("--yes")) { console.log("this replaces everything on", to, "with", file, check(file), "\nrun again with --yes"); process.exit(1); }
      console.log(await restore(file, { server: to.replace(/\/$/, ""), auth: token() }));
    } else { console.log("usage: node tools/backup.mjs login | pull | check <file> | restore <file> --to <url> --yes"); process.exit(1); }
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
