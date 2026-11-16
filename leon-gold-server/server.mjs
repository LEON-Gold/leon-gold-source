// Leon Gold sync server: one shared copy of the ledger's data for every device.
// The ledger keeps working offline from its own IndexedDB; it pushes its changes here and pulls everyone else's.
// Storage is a single SQLite file in DATA_DIR. No dependencies beyond Node 24.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import * as portal from "./portal.mjs";
import * as gym from "./gym.mjs";
import * as notify from "./notify.mjs";
import * as web from "./web.mjs";
import * as debts from "./debts.mjs";
import * as visits from "./visits.mjs";
import * as banksms from "./banksms.mjs";
import * as melt from "./melt.mjs";

const PORT = +(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const ORIGINS = [...new Set([...(process.env.ALLOWED_ORIGINS || "https://leon-gold.github.io").split(",").map(s => s.trim()).filter(Boolean),
  // the site this server itself serves on the owner's domain (web.mjs) always reaches the API
  "https://leongold.net", "https://www.leongold.net"])];
const SESSION_DAYS = 180;
const MAX_JSON = 60 * 1024 * 1024, MAX_BLOB = 15 * 1024 * 1024, MAX_MEDIA = 80 * 1024 * 1024;

fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, "leon.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT, rev INTEGER NOT NULL, at TEXT NOT NULL, by TEXT, PRIMARY KEY (col, id));
  CREATE INDEX IF NOT EXISTS docs_rev ON docs (rev);
  CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, bytes BLOB NOT NULL, rev INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS blobs_rev ON blobs (rev);
  CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, device TEXT, created TEXT NOT NULL, seen TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
portal.setup(db);
gym.setup(db);

// one counter orders every change, so a device only asks for what came after the last number it saw
const getRev = () => +(db.prepare("SELECT v FROM meta WHERE k='rev'").get()?.v || 0);
const setRev = r => db.prepare("INSERT INTO meta (k, v) VALUES ('rev', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(String(r));

// ---------- users ----------
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const scrypt = (pass, salt) => crypto.scryptSync(pass.normalize("NFKC"), salt, 32).toString("hex");
// Persian/Arabic digits typed on the phone count the same as Latin ones
const digits = s => String(s).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const userKey = s => digits(s).trim().toLowerCase();
const passKey = s => digits(s).trim();

export function setUser(name, pass) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO users (name, salt, hash) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET salt = excluded.salt, hash = excluded.hash")
    .run(userKey(name), salt, scrypt(passKey(pass), salt));
  db.prepare("DELETE FROM sessions WHERE user = ?").run(userKey(name)); // a new password signs out the old devices
}
function checkUser(name, pass) {
  const u = db.prepare("SELECT * FROM users WHERE name = ?").get(userKey(name));
  if (!u) { scrypt("x", "decoy-salt"); return null; } // same time whether or not the user exists
  const h = Buffer.from(scrypt(passKey(pass), u.salt), "hex");
  // the ledger is the owner's alone: any other login fails the same way as a wrong password, after the same work
  return crypto.timingSafeEqual(h, Buffer.from(u.hash, "hex")) && isOwnerUser(u.name) ? u.name : null;
}
// the ledger's own sign-in users (settings/lock, synced like the rest of its data: a name and a numeric password,
// sha256 of "salt|digits", the same as pinHash() in leon-gold/index.html) also sign a new device in, as the owner:
// the ledger is the owner's alone, so whoever its lock lets in is the owner
const lockHash = (pin, salt) => { const s = salt + "|" + digits(pin).replace(/\D/g, "");
  return "sha:" + sha(s) + " fnv:f" + [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16); };
const lockKey = s => digits(s).replace(/\s+/g, " ").trim().toLowerCase();
function checkLock(name, pass) {
  const row = db.prepare("SELECT data FROM docs WHERE col = 'settings' AND id = 'lock' AND data IS NOT NULL").get();
  if (!row || !String(pass ?? "").trim()) return null;
  const L = JSON.parse(row.data), users = Array.isArray(L.users) ? L.users : L.hash ? [{ u: "مدیر", hash: L.hash, salt: L.salt || "" }] : [];
  const u = users.find(x => x && x.hash && lockKey(x.u) === lockKey(name));
  if (!u) return null;
  let ok;
  if (u.kdf === "p2") { // set since 2026-11-09: PBKDF2-SHA256, 150 000 rounds (pinMake() in leon-gold/index.html)
    // letters allowed (2026-11-09): Persian digits read as Latin ones, NFKC, as pwNorm() in the ledger
    const h = crypto.pbkdf2Sync(digits(String(pass)).normalize("NFKC").trim(), String(u.salt || ""), 150000, 32, "sha256");
    ok = /^[0-9a-f]{64}$/.test(u.hash) && crypto.timingSafeEqual(h, Buffer.from(u.hash, "hex"));
  } else {
    const [s, f] = lockHash(pass, u.salt || "").split(" ");
    ok = s === "sha:" + u.hash || f === "fnv:" + u.hash; // fnv: phones without WebCrypto saved that instead
  }
  return ok ? (SETUP.u ? userKey(SETUP.u) : userKey(u.u)) : null;
}
// the owner is SETUP_USER; with none configured (a local test server) there is only one kind of login, as before
const isOwnerUser = name => SETUP.u ? name === userKey(SETUP.u) : true;
// SETUP_USER / SETUP_PASS (set in the Liara panel) are the owner's login: on every start that user gets that
// password, unless it already has it (so a restart does not sign the devices out). Quotes and spaces around them are ignored.
const envVal = k => String(process.env[k] || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
export const SETUP = { u: envVal("SETUP_USER"), p: envVal("SETUP_PASS") };
if (SETUP.u && SETUP.p && !checkUser(SETUP.u, SETUP.p)) setUser(SETUP.u, SETUP.p);
console.log(SETUP.u && SETUP.p ? `owner login: "${userKey(SETUP.u)}" (password ${passKey(SETUP.p).length} characters)` : "SETUP_USER / SETUP_PASS not set");

// failed logins: 10 per address per 15 minutes
// and 20 per username, since the address comes from X-Forwarded-For, which a caller can change on every try
// (signed-in devices keep working while a username is blocked; only new logins wait)
const fails = new Map();
const blocked = (k, max = 10) => { const f = fails.get(k); return f && f.n >= max && Date.now() - f.t < 15 * 60e3; };
const failed = k => {
  const f = fails.get(k), now = Date.now();
  if (fails.size > 10000) for (const [x, v] of fails) if (now - v.t >= 15 * 60e3) fails.delete(x);
  fails.set(k, f && now - f.t < 15 * 60e3 ? { n: f.n + 1, t: f.t } : { n: 1, t: now });
};

function openSession(name, device) {
  const token = crypto.randomBytes(32).toString("base64url"), now = new Date().toISOString();
  db.prepare("INSERT INTO sessions (token, user, device, created, seen) VALUES (?, ?, ?, ?, ?)").run(sha(token), name, String(device || "").slice(0, 80), now, now);
  return token;
}
// one-time codes the ledger hands to the management panel (kept in memory: a restart only cancels codes not yet used)
const WAIT_S = +(process.env.WAIT_S || 25);
const HANDOFF_S = 60, handoffs = new Map();

function session(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(sha(m[1]));
  // (a session of any login other than the owner's, made before the ledger became owner-only, no longer opens anything)
  if (!s || Date.now() - Date.parse(s.created) > SESSION_DAYS * 864e5 || !isOwnerUser(s.user)) return null;
  db.prepare("UPDATE sessions SET seen = ? WHERE token = ?").run(new Date().toISOString(), s.token);
  return s;
}

// ---------- data ----------
const COL = /^[A-Za-z_][\w-]{0,40}$/, ID = /^[\w.:-]{1,200}$/;

// devices waiting to hear of a change (GET /api/wait): each is answered as soon as anything is saved
const waiters = new Set();
const wake = () => { for (const w of [...waiters]) w(); };
function push(changes, who) {
  let rev = getRev();
  const at = new Date().toISOString();
  const up = db.prepare("INSERT INTO docs (col, id, data, rev, at, by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, rev = excluded.rev, at = excluded.at, by = excluded.by");
  // the showcase and the orders as they were, so «حساب من» can be told what is new (notify.mjs)
  const old = db.prepare("SELECT data FROM docs WHERE col = ? AND id = ?"), seen = [];
  // and every section the ledger's own users hear about (notify.ledger), with the change log that says who did it
  const logs = [];
  for (const ch of changes) {
    if (!ch || !ID.test(ch.id || "")) continue;
    if (ch.c === "log" && ch.d) logs.push(ch.d);
    if (ch.c === "vitrin" || ch.c === "orders" || notify.LEDGER_COLS.includes(ch.c)) { const r = old.get(ch.c, ch.id); seen.push({ c: ch.c, id: ch.id, before: r && r.data ? JSON.parse(r.data) : null, after: ch.d || null }); }
  }
  db.exec("BEGIN");
  try {
    for (const ch of changes) {
      if (!ch || typeof ch !== "object" || !COL.test(ch.c || "") || !ID.test(ch.id || "")) throw Object.assign(new Error("bad change " + (ch && ch.c) + "/" + (ch && ch.id)), { code: 400 });
      up.run(ch.c, ch.id, ch.d == null ? null : JSON.stringify(ch.d), ++rev, at, who);
    }
    setRev(rev);
    db.exec("COMMIT");
    setImmediate(wake);
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  if (seen.length) try { notify.changed(seen.filter(x => x.c === "vitrin" || x.c === "orders")); } catch (e) { console.error("notify", e.message); }
  if (seen.length) try { notify.ledger(seen, logs, who); } catch (e) { console.error("notify ledger", e.message); }
  return rev;
}

function pull(since, limit = 2000) {
  const docs = db.prepare("SELECT col, id, data, rev FROM docs WHERE rev > ? ORDER BY rev LIMIT ?").all(since, limit);
  const top = docs.length === limit ? docs[docs.length - 1].rev : getRev();
  const blobs = db.prepare("SELECT id FROM blobs WHERE rev > ? AND rev <= ?").all(since, top).map(b => b.id);
  return { rev: top, more: docs.length === limit, changes: docs.map(r => ({ c: r.col, id: r.id, d: r.data == null ? null : JSON.parse(r.data) })), blobs };
}

// ---------- backups: a copy of the whole database once a day, the last 30 kept ----------
export function backup() {
  const dir = path.join(DATA_DIR, "backups"), day = new Date().toISOString().slice(0, 10), f = path.join(dir, `leon-${day}.db`);
  if (fs.existsSync(f)) return null;
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  fs.readdirSync(dir).filter(n => /^leon-.*\.db$/.test(n)).sort().slice(0, -30).forEach(n => fs.unlinkSync(path.join(dir, n)));
  return f;
}

// the off-site copy the owner's PC downloads (tools/backup.mjs): the ledger's data and photos, without logins or
// sessions, so a lost copy opens no device. Written to a temp file, sent, removed.
export function exportCopy() {
  const f = path.join(DATA_DIR, "backups", `tmp-${crypto.randomBytes(6).toString("hex")}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const c = new DatabaseSync(f);
  try { for (const t of ["users", "sessions", "portal_logins", "portal_invites", "portal_sessions", "portal_signups", ...gym.SECRET_TABLES]) c.exec(`DELETE FROM ${t}`); c.exec("VACUUM"); }
  finally { c.close(); }
  return f;
}

// ---------- http ----------
// the site's address in what the server writes: «حساب من» invite links, notification taps, this address opened in a browser
// (owner, 2026-11-15: on the domain now; SITE_URL to override)
const SITE = (process.env.SITE_URL || "https://leongold.net/").replace(/\/?$/, "/");
notify.setup(db, SITE);
// once (owner, 2026-11-09): «خانگی» is «مشتری تک‌فروشی» everywhere: parties of that kind, the showcase wages given to it,
// and the owner's own list of kinds. Synced like any other change (who = "system", so no notifications); runs once per database.
export function migrateHome(force) {
  if (!force && db.prepare("SELECT 1 FROM meta WHERE k = 'mig_home'").get()) return 0;
  const ch = [], rows = col => db.prepare("SELECT id, data FROM docs WHERE col = ? AND data IS NOT NULL").all(col).map(r => ({ id: r.id, d: JSON.parse(r.data) }));
  for (const { id, d } of rows("parties")) if (d.biz === "home") ch.push({ c: "parties", id, d: { ...d, biz: "retail" } });
  for (const { id, d } of rows("vitrin")) if (Array.isArray(d.prices) && d.prices.some(p => p && Array.isArray(p.biz) && p.biz.includes("home")))
    ch.push({ c: "vitrin", id, d: { ...d, prices: d.prices.map(p => p && Array.isArray(p.biz) ? { ...p, biz: [...new Set(p.biz.map(k => k === "home" ? "retail" : k))] } : p) } });
  for (const { id, d } of rows("settings")) if (id === "biz" && Array.isArray(d.types) && d.types.some(t => t && t.k === "home" && !t.off))
    ch.push({ c: "settings", id, d: { ...d, types: d.types.map(t => t && t.k === "home" ? { ...t, off: true } : t) } });
  if (ch.length) push(ch, "system");
  db.prepare("INSERT INTO meta (k, v) VALUES ('mig_home', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(new Date().toISOString());
  return ch.length;
}
try { const n = migrateHome(); if (n) console.log("«خانگی» → «مشتری تک‌فروشی»:", n, "docs"); } catch (e) { console.error("migrate home", e.message); }
// a showcase photo or film («ویترین»): images, and the videos a phone records
export const mediaType = t => { t = String(t || "").split(";")[0].trim().toLowerCase(); return /^(image\/(jpeg|png|webp|gif|heic|heif|avif)|video\/(mp4|quicktime|webm))$/.test(t) ? t : null; };
const photoType = t => { t = String(t || "image/jpeg").split(";")[0].trim().toLowerCase(); return /^image\/(jpeg|png|webp|gif|heic|heif|avif)$/.test(t) ? t : "application/octet-stream"; };
function body(req, max) {
  return new Promise((res, rej) => {
    const parts = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > max) { rej(Object.assign(new Error("too large"), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on("end", () => res(Buffer.concat(parts))); req.on("error", rej);
  });
}
const json = async req => {
  let v;
  try { v = JSON.parse((await body(req, MAX_JSON)).toString("utf8") || "{}"); } catch (e) { throw Object.assign(e, { code: e.code || 400 }); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Object.assign(new Error("bad json"), { code: 400 });
  return v;
};

visits.setup(db);
melt.setup(db);
// hits per address, emptied every minute
const hits = new Map(); setInterval(() => hits.clear(), 60e3).unref();
setInterval(() => { try { visits.prune(db); } catch (e) { console.error("visits", e); } }, 24 * 3600e3).unref();
export const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // the server answers only JSON and stored media, never a page: nothing may run, load or be framed from it, HTTPS only
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  const url = new URL(req.url, "http://x"), p = url.pathname.replace(/^\/daftar(?=\/api\/)/, "");
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  try {
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    // leongold.net and www: the public site's own files (web.mjs); the API paths fall through
    if (web.serve(req, res, url.pathname)) return;
    if (p === "/api/health") return send(200, { ok: true });
    // someone opening the server's address in a browser goes straight to the site
    if ((p === "/" || p === "/index.html") && req.method === "GET") { res.writeHead(302, { Location: SITE }); return res.end(); }
    // the personal routine app («روتین من»): its page and its own logins, apart from the ledger
    if (req.method === "GET" && gym.page(p, res)) return;
    if (p.startsWith("/api/gym/")) return await gym.handle(db, req, p, { send, json, body, ip, res });

    if (p === "/api/login" && req.method === "POST") {
      if (blocked("ip " + ip)) return send(429, { error: "too_many" });
      const { u, p: pass, device } = await json(req), uk = "user " + lockKey(u || ""); // (the same key the ledger-lock name is compared by, so extra spaces in the name make no new counter)
      if (blocked(uk, 20)) return send(429, { error: "too_many" });
      const name = u && pass ? checkUser(u, pass) || checkLock(u, pass) : null;
      if (!name) { failed("ip " + ip); failed(uk); return send(401, { error: "bad_login" }); }
      fails.delete("ip " + ip); fails.delete(uk);
      return send(200, { token: openSession(name, device), user: name });
    }
    // the management panel opened from the ledger's menu: a one-time code from /api/handoff becomes its own session
    if (p === "/api/handoff/redeem" && req.method === "POST") {
      if (blocked("ip " + ip)) return send(429, { error: "too_many" });
      const code = String((await json(req)).code || ""), h = code && handoffs.get(sha(code));
      if (h) handoffs.delete(sha(code));
      if (!h || Date.now() > h.exp) { failed("ip " + ip); return send(401, { error: "expired" }); }
      return send(200, { token: openSession(h.user, "panel"), user: h.user });
    }

    // a page of the public site was opened (visits.mjs): no sign-in, nothing back, at most a few a second per address
    if (p === "/api/public/hit" && req.method === "POST") {
      const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); if (n > 30) return send(429, { error: "too_many" });
      let b = {}; try { b = await json(req); } catch {}
      visits.hit(db, b.p, ip, req.headers["user-agent"]); res.writeHead(204); return res.end();
    }
    // a bank SMS from the owner's iPhone shortcut (banksms.mjs): its own key, no session
    if (p === "/api/public/banksms" && req.method === "POST") {
      const n = (hits.get("sms " + ip) || 0) + 1; hits.set("sms " + ip, n); if (n > 20) return send(429, { error: "too_many" });
      let b = {}; try { b = await json(req); } catch {}
      if (!banksms.keyOk(db, b.k)) { failed("ip " + ip); return send(401, { error: "key" }); }
      if (!String(b.text || "").trim()) return send(400, { error: "text" });
      const { id, d } = banksms.doc(b.text);
      // the same message again (the shortcut run by hand, or twice for one message): not filed a second time
      if (db.prepare("SELECT 1 FROM docs WHERE col = 'bankmsgs' AND data IS NOT NULL AND json_extract(data, '$.text') = ?").get(d.text))
        return send(200, { ok: true, dup: true, bank: d.bank, dir: d.dir, amount: d.amount, bal: d.bal });
      push([{ c: "bankmsgs", id, d }], "system");
      return send(200, { ok: true, bank: d.bank, dir: d.dir, amount: d.amount, bal: d.bal });
    }
    // customers' and suppliers' own panel («حساب من»), with its own sessions
    // «خرید و فروش آبشده» for colleagues (melt.mjs)
    if (p === "/api/portal/melt" || p.startsWith("/api/portal/melt/")) return await melt.handlePortal(db, req, p, { send, json, tooMany: portal.tooMany, tellOwners: notify.tellOwners });
    if (p.startsWith("/api/portal/") || p.startsWith("/api/public/")) return await portal.handle(db, req, p, { send, json, ip, owner: () => session(req), site: SITE, res, push });

    const s = session(req);
    if (!s) return send(401, { error: "login" });

    // a new key for the bank SMS shortcut; the old one stops working (banksms.mjs)
    if (p === "/api/banksms/key" && req.method === "POST") return send(200, { key: banksms.setKey(db) });
    // «خرید و فروش آبشده»: the orders to approve, the prices, approve / reject / resolve (melt.mjs)
    if (p.startsWith("/api/melt/")) { const r = await melt.handleOwner(db, req, p, { send, json, push, who: s.user }); if (r !== null) return r; return send(404, { error: "not_found" }); }
    // the site's visits, for the ledger's home (visits.mjs)
    if (p === "/api/visits" && req.method === "GET") return send(200, visits.stats(db));
    if (p === "/api/state" && req.method === "GET") {
      const n = db.prepare("SELECT count(*) AS n FROM docs WHERE data IS NOT NULL").get().n;
      return send(200, { rev: getRev(), docs: n, blobs: db.prepare("SELECT count(*) AS n FROM blobs").get().n });
    }
    if (p === "/api/pull" && req.method === "GET") return send(200, pull(+url.searchParams.get("since") || 0));
    // the ledger keeps one of these open while it is on screen: answered at once if there is something newer than «since»,
    // else held until something is saved (or WAIT_S seconds pass), so a new order shows in the ledger within a second
    if (p === "/api/wait" && req.method === "GET") {
      const since = +url.searchParams.get("since") || 0;
      if (getRev() > since) return send(200, { rev: getRev() });
      let done = false, t = null;
      const fin = () => { if (done) return; done = true; waiters.delete(fin); clearTimeout(t); if (!res.writableEnded && !res.destroyed) send(200, { rev: getRev() }); };
      t = setTimeout(fin, WAIT_S * 1000); waiters.add(fin); res.on("close", fin);
      return;
    }
    if (p === "/api/push" && req.method === "POST") {
      const { changes } = await json(req);
      if (!Array.isArray(changes)) return send(400, { error: "changes" });
      return send(200, { rev: push(changes, s.user) });
    }
    if (p === "/api/backup" && req.method === "GET") {
      const f = exportCopy(), done = () => fs.rm(f, { force: true }, () => {});
      res.writeHead(200, { "Content-Type": "application/vnd.sqlite3", "Content-Length": fs.statSync(f).size, "Content-Disposition": `attachment; filename="leon-${new Date().toISOString().slice(0, 10)}.db"` });
      return fs.createReadStream(f).on("close", done).on("error", done).pipe(res);
    }
    // this device's notifications for its ledger user (notify.mjs)
    if (p.startsWith("/api/notify/")) return await notify.handleLedger(req, p, { send, json });
    if (p === "/api/logout" && req.method === "POST") { db.prepare("DELETE FROM sessions WHERE token = ?").run(s.token); return send(200, { ok: true }); }

    if (p === "/api/handoff" && req.method === "POST") {
      const now = Date.now(), code = crypto.randomBytes(18).toString("base64url");
      for (const [k, v] of handoffs) if (now > v.exp) handoffs.delete(k);
      handoffs.set(sha(code), { user: s.user, exp: now + HANDOFF_S * 1000 });
      return send(200, { code, ttl: HANDOFF_S });
    }

    // the showcase's photos and films: kept on the server only (rev 0, never pulled onto the devices), up to 80 MB each
    const mm = /^\/api\/media\/([\w.-]{1,100})$/.exec(p);
    if (mm && req.method === "PUT") {
      const type = mediaType(req.headers["content-type"]);
      if (!type) return send(400, { error: "bad_type" });
      const bytes = await body(req, MAX_MEDIA);
      db.prepare("INSERT INTO blobs (id, type, bytes, rev) VALUES (?, ?, ?, 0) ON CONFLICT (id) DO NOTHING").run(mm[1], type, bytes);
      return send(200, { ok: true });
    }
    if (mm && req.method === "GET") {
      const b = db.prepare("SELECT type, bytes FROM blobs WHERE id = ?").get(mm[1]);
      if (!b) return send(404, { error: "not_found" });
      res.writeHead(200, { "Content-Type": mediaType(b.type) || "application/octet-stream", "Content-Security-Policy": "sandbox; default-src 'none'" }); return res.end(Buffer.from(b.bytes));
    }

    const bm = /^\/api\/blob\/([\w.-]{1,100})$/.exec(p);
    if (bm && req.method === "PUT") {
      const bytes = await body(req, MAX_BLOB), rev = getRev() + 1;
      db.prepare("INSERT INTO blobs (id, type, bytes, rev) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING").run(bm[1], photoType(req.headers["content-type"]), bytes, rev);
      setRev(rev);
      return send(200, { ok: true });
    }
    if (bm && req.method === "GET") {
      const b = db.prepare("SELECT type, bytes FROM blobs WHERE id = ?").get(bm[1]);
      if (!b) return send(404, { error: "not_found" });
      // a photo is only ever shown as a picture: never run as a page, whatever type it was sent with
      res.writeHead(200, { "Content-Type": photoType(b.type), "Content-Security-Policy": "sandbox; default-src 'none'" }); return res.end(Buffer.from(b.bytes));
    }
    send(404, { error: "not_found" });
  } catch (e) {
    // our own errors (400, 413) say what was wrong; anything else stays in the log, not in the answer
    if (typeof e.code !== "number") { console.error(e); return res.headersSent ? res.destroy() : send(500, { error: "server" }); }
    send(e.code, { error: String(e.message || e) });
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  // one bad request or a failed notification must not take the ledger's sync down with it: logged, the server keeps answering
  process.on("unhandledRejection", e => console.error("unhandled", e));
  process.on("uncaughtException", e => console.error("uncaught", e));
  server.listen(PORT, () => console.log(`leon-gold-server on :${PORT}, data in ${DATA_DIR}`));
  // the day's copy a little after starting, so a large database never keeps a fresh start from answering
  setTimeout(() => { try { backup(); } catch (e) { console.error("backup", e); } }, 90e3);
  setInterval(() => { try { backup(); } catch (e) { console.error("backup", e); } }, 60 * 60e3);
  // «حساب من» reminders (own password, details): looked at every 6 hours, each sent at most once a week (portal.mjs nudges)
  const nudge = () => { try { portal.nudges(db, notify.tellParty); } catch (e) { console.error("nudges", e); } };
  setTimeout(nudge, 5 * 60e3); setInterval(nudge, 6 * 3600e3);
  // the week's debts for the owner, Saturdays from 10:00 Tehran time (debts.mjs)
  const dweek = () => { try { debts.weekly(db, notify.tellOwners); } catch (e) { console.error("debts", e); } };
  setTimeout(dweek, 2 * 60e3); setInterval(dweek, 10 * 60e3);
}
