// «روتین من»: a personal training / diet / sleep routine app, separate from the business.
// The page lives in gym/ and is served at /gym/; its API is /api/gym/*. It has its own logins, sessions and data
// (tables gym_*): a gym login never opens the ledger, and a ledger session never opens this.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as notify from "./notify.mjs";

const SESSION_DAYS = 365, MAX_DATA = 5 * 1024 * 1024, MAX_FILE = 6 * 1024 * 1024, LOGIN_FAILS = 10;
const DIR = path.join(import.meta.dirname, "gym");
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const scrypt = (pass, salt) => crypto.scryptSync(pass.normalize("NFKC"), salt, 32).toString("hex");
const digits = s => String(s).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const tehranDay = () => new Date(Date.now() + 3.5 * 3600e3).toISOString().slice(0, 10); // Iran has no DST since 2022
const nameKey = s => digits(s).trim().toLowerCase();
const passKey = s => digits(s).trim();
const NAME = /^[\p{L}\p{N}._-]{3,40}$/u, FILE_ID = /^[a-f0-9]{8,40}$/;

// the first admin, made once on an empty table (owner's choice of username and password, 2026-10-31; change it in the app)
const FIRST = { name: "leon", salt: "0c0a77d0af32b37421aeb7d5a2c8ffb8", hash: "02cc568c08ed25299d06a8e016a93aa5d3a89b5525f336975bcdf212cfca76f2" };

export function setup(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gym_users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gym_sessions (token TEXT PRIMARY KEY, user TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gym_data (user TEXT PRIMARY KEY, data TEXT NOT NULL, rev INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gym_files (id TEXT PRIMARY KEY, user TEXT NOT NULL, type TEXT NOT NULL, bytes BLOB NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gym_push_subs (endpoint TEXT PRIMARY KEY, user TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gym_food_marks (food TEXT NOT NULL, user TEXT NOT NULL, kind TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (food, user, kind, day));
    CREATE TABLE IF NOT EXISTS gym_push_plan (user TEXT NOT NULL, at INTEGER NOT NULL, tag TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (user, at, tag));
  `);
  if (!db.prepare("SELECT count(*) AS n FROM gym_users").get().n)
    db.prepare("INSERT INTO gym_users (name, salt, hash, role, created) VALUES (?, ?, ?, 'admin', ?)").run(FIRST.name, FIRST.salt, FIRST.hash, Date.now());
  clearInterval(tick); tick = setInterval(() => due(db).catch(e => console.error("gym push", e.message)), TICK_MS); tick.unref?.();
}
// logins, sessions and push addresses never leave the server (dropped from the off-site copy)
export const SECRET_TABLES = ["gym_users", "gym_sessions", "gym_push_subs", "gym_push_plan"];

// ---------- reminders: the page works out the next days' steps (meals, supplements, gym, sleep) and hands their times here;
// each one goes to the user's subscribed devices when it is due. One missed by more than 15 minutes (server down) is dropped.
const TICK_MS = +(process.env.GYM_PUSH_TICK_MS || 30000), PLAN_MAX = 400, PLAN_DAYS = 16, SUBS_PER_USER = 10;
let tick = null, sending = false;
async function due(db) {
  if (sending) return;
  sending = true;
  try {
    const now = Date.now(), rows = db.prepare("SELECT * FROM gym_push_plan WHERE at <= ? ORDER BY at").all(now);
    if (!rows.length) return;
    db.prepare("DELETE FROM gym_push_plan WHERE at <= ?").run(now);
    for (const r of rows) if (now - r.at < 15 * 60e3) await sendTo(db, r.user, { title: r.title, body: r.body, tag: r.tag, url: "/gym/" });
  } finally { sending = false; }
}
async function sendTo(db, user, msg) {
  const out = [];
  for (const s of db.prepare("SELECT * FROM gym_push_subs WHERE user = ?").all(user)) {
    const r = await notify.sendPush(s, msg);
    if (r.status === 404 || r.status === 410) db.prepare("DELETE FROM gym_push_subs WHERE endpoint = ?").run(s.endpoint);
    out.push(r);
  }
  return out;
}

const fails = new Map();
const blocked = (k, max = LOGIN_FAILS) => { const f = fails.get(k); return !!f && f.n >= max && Date.now() - f.t < 15 * 60e3; };
const failed = k => { const f = fails.get(k), now = Date.now(); if (fails.size > 10000) for (const [x, v] of fails) if (now - v.t >= 15 * 60e3) fails.delete(x); fails.set(k, f && now - f.t < 15 * 60e3 ? { n: f.n + 1, t: f.t } : { n: 1, t: now }); };

function setPass(db, name, pass) {
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE gym_users SET salt = ?, hash = ? WHERE name = ?").run(salt, scrypt(pass, salt), name);
}
function check(row, pass) {
  const h = Buffer.from(scrypt(pass, row ? row.salt : "decoy-salt"), "hex"); // same work whether or not the user exists
  return !!row && crypto.timingSafeEqual(h, Buffer.from(row.hash, "hex"));
}
function newSession(db, user) {
  const token = crypto.randomBytes(32).toString("base64url"), now = Date.now();
  db.prepare("INSERT INTO gym_sessions (token, user, created, seen) VALUES (?, ?, ?, ?)").run(sha(token), user, now, now);
  return token;
}
function session(db, req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const s = db.prepare("SELECT s.*, u.role FROM gym_sessions s JOIN gym_users u ON u.name = s.user WHERE s.token = ?").get(sha(m[1]));
  if (!s) return null;
  if (Date.now() - s.created > SESSION_DAYS * 864e5) { db.prepare("DELETE FROM gym_sessions WHERE token = ?").run(s.token); return null; }
  if (Date.now() - s.seen > 3600e3) db.prepare("UPDATE gym_sessions SET seen = ? WHERE token = ?").run(Date.now(), s.token);
  return s;
}

// ---------- reading uploaded plans: the page sends a file's text and page images, an AI service returns the values as JSON.
// Any OpenAI-compatible service works (it must be reachable from the server, which runs in Iran, e.g. Liara's own AI):
// GYM_AI_URL (base URL, the part before /chat/completions), GYM_AI_KEY, GYM_AI_MODEL. Without them the page says reading is off.
const envVal = k => String(process.env[k] || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
const AI = { url: envVal("GYM_AI_URL").replace(/\/+$/, ""), key: envVal("GYM_AI_KEY"), model: envVal("GYM_AI_MODEL") || "openai/gpt-4o-mini" };
const aiOn = () => !!(AI.url && AI.key);
const MAX_EXTRACT = 14 * 1024 * 1024, EXTRACTS_PER_DAY = 40, extracts = new Map();
const ASK = {
  tests: `This is a body-composition result (InBody or similar) or a lab test. Return JSON:
{"date": "YYYY-MM-DD gregorian or null", "date_jalali": "YYYY/MM/DD if the sheet shows a Persian date, else null", "sex": "m|f|null", "age": n, "height": cm, "weight": kg,
 "bmi": n, "fat": percent body fat, "fatMass": kg, "smm": skeletal muscle mass kg, "lbm": fat-free mass kg, "visceral": visceral fat level, "whr": waist-hip ratio,
 "bmr": kcal, "score": InBody score, "waist": cm, "hip": cm, "goalWeight": target weight kg, "notes": "short Persian summary of anything else important (segmental results, lab values out of range)"}
Use null for anything not on the sheet. Numbers as plain numbers with a dot.`,
  diet: `This is a diet plan from a nutritionist. Return JSON:
{"kcal": daily calories or null, "text": "short Persian summary of the rules (portions, swaps, free foods, cheat meal…)",
 "menus": {"breakfast": [[name, amounts]], "msnack": [...], "lunch": [...], "snack": [...], "pre": [...], "post": [...], "dinner": [...], "bed": [...]}}
menus: every option the plan gives for each meal, name short in Persian, amounts as written. msnack = mid-morning snack, snack = afternoon snack, pre/post = before/after training, bed = before sleep. Empty list when the plan has none.`,
  supp: `This is a supplement plan. Return JSON:
{"supps": [{"name": Persian name, "dose": "amount as written", "when": "wake|breakfast|pre|post|lunch|snack|dinner|bed", "days": "all|train|rest", "note": "course length, cycles or other notes"}]}
One entry per dose time (a supplement taken twice a day is two entries).`,
  workout: `This is a gym training program. Return JSON:
{"notes": "short Persian summary of the general rules (rest times, drop sets, cardio…)",
 "sessions": [{"name": "Persian title of the session, e.g. سینه و پشت بازو", "weekday": "sat|sun|mon|tue|wed|thu|fri or null",
   "ex": [{"n": "exercise name in Persian as written", "r": "sets and reps as written, e.g. ۴ ست ۱۲، ۱۰، ۸، ۶", "g": "group label like سوپرست or تری‌ست when exercises are done together, else null", "d": true if drop set}]}]}
Keep the program's order. One session per training day of the program.`
};
async function extract(kind, text, images) {
  const user = [{ type: "text", text: ASK[kind] + "\n\nText found in the file (may be empty or partial):\n" + String(text || "").slice(0, 30000) }]
    .concat(images.map(url => ({ type: "image_url", image_url: { url } })));
  const ask = async json => fetch(AI.url + "/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + AI.key, "Content-Type": "application/json" }, signal: AbortSignal.timeout(150e3),
    body: JSON.stringify({ model: AI.model, temperature: 0, ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "system", content: "You read health and fitness documents (mostly Persian) and answer with one JSON object only, no prose." }, { role: "user", content: user }] })
  });
  let r = await ask(true);
  if (r.status === 400) r = await ask(false); // some services don't take response_format
  if (!r.ok) { console.error("gym ai", r.status, (await r.text()).slice(0, 300)); throw Object.assign(new Error("ai_failed"), { code: 502 }); }
  const s = (await r.json())?.choices?.[0]?.message?.content || "", m = s.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m[0]); } catch (e) { throw Object.assign(new Error("ai_unreadable"), { code: 502 }); }
}

// ---------- the page: gym/ served at /gym/
const TYPES = { html: "text/html; charset=utf-8", png: "image/png", jpg: "image/jpeg", webmanifest: "application/manifest+json", js: "text/javascript; charset=utf-8" };
export function page(p, res) {
  if (p === "/gym") { res.writeHead(301, { Location: "/gym/" }); res.end(); return true; }
  // the page's own files, and its food photos in img/ (one folder deep, plain names only: no way out of gym/)
  const m = /^\/gym\/((?:img\/)?[\w.-]*)$/.exec(p);
  if (!m || m[1].includes("..")) return false;
  const f = m[1] || "index.html", t = TYPES[f.split(".").pop()];
  if (!t || !fs.existsSync(path.join(DIR, f))) return false;
  // the page's own policy (the server's default is "nothing"): its scripts and styles, Google Fonts, its own API,
  // pdf.js's worker, and blob: links for opening a user's files
  res.writeHead(200, { "Content-Type": t, "Cache-Control": f === "index.html" || f === "sw.js" ? "no-cache" : "max-age=604800",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
  res.end(fs.readFileSync(path.join(DIR, f)));
  return true;
}

// ---------- api
export async function handle(db, req, p, { send, json, body, ip, res }) {
  const M = req.method;
  if (p === "/api/gym/login" && M === "POST") {
    if (blocked("ip " + ip)) return send(429, { error: "too_many" });
    const b = await json(req), u = nameKey(b.u || "");
    if (blocked("u " + u, 20)) return send(429, { error: "too_many" });
    const row = u ? db.prepare("SELECT * FROM gym_users WHERE name = ?").get(u) : null;
    if (!check(row, passKey(b.p || ""))) { failed("ip " + ip); failed("u " + u); return send(401, { error: "bad_login" }); }
    fails.delete("ip " + ip); fails.delete("u " + u);
    return send(200, { token: newSession(db, row.name), user: row.name, role: row.role });
  }

  const s = session(db, req);
  if (!s) return send(401, { error: "login" });
  const admin = s.role === "admin";

  if (p === "/api/gym/me" && M === "GET") return send(200, { user: s.user, role: s.role, ai: aiOn() });

  // ---------- «غذاها» (the diet food explorer): views and "I cooked it", shared by everyone who uses the app.
  // One mark per food, user, kind and day: views = person-days that opened it, cooks = days someone cooked it.
  if (p === "/api/gym/foods/stats" && M === "GET") {
    const foods = {};
    for (const r of db.prepare("SELECT food, kind, count(*) AS n, sum(user = ?) AS me FROM gym_food_marks GROUP BY food, kind").all(s.user)) {
      const f = foods[r.food] ||= { views: 0, cooks: 0, myCooks: 0 };
      if (r.kind === "view") f.views = r.n; else { f.cooks = r.n; f.myCooks = r.me; }
    }
    const today = tehranDay();
    const cookedToday = db.prepare("SELECT food FROM gym_food_marks WHERE user = ? AND kind = 'cook' AND day = ?").all(s.user, today).map(r => r.food);
    return send(200, { foods, cookedToday });
  }
  if (p === "/api/gym/foods/mark" && M === "POST") {
    const b = await json(req), id = String(b.id || ""), kind = b.kind === "cook" ? "cook" : b.kind === "view" ? "view" : "";
    if (!/^[a-z0-9-]{2,40}$/.test(id) || !kind) return send(400, { error: "input" });
    const day = tehranDay();
    if (kind === "cook" && b.undo) db.prepare("DELETE FROM gym_food_marks WHERE food = ? AND user = ? AND kind = 'cook' AND day = ?").run(id, s.user, day);
    else db.prepare("INSERT OR IGNORE INTO gym_food_marks (food, user, kind, day) VALUES (?, ?, ?, ?)").run(id, s.user, kind, day);
    return send(200, { ok: true });
  }

  // ---------- reminders («یادآورها»)
  if (p === "/api/gym/push/key" && M === "GET") return send(200, { key: notify.publicKey() });
  if (p === "/api/gym/push/sub" && M === "POST") {
    const b = await json(req), ep = String(b.endpoint || ""), k = b.keys || {};
    if (!notify.okEndpoint(ep) || !/^[\w-]{80,100}$/.test(k.p256dh || "") || !/^[\w-]{16,32}$/.test(k.auth || "")) return send(400, { error: "bad_sub" });
    db.prepare("INSERT INTO gym_push_subs (endpoint, user, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user = excluded.user, p256dh = excluded.p256dh, auth = excluded.auth")
      .run(ep, s.user, k.p256dh, k.auth, Date.now());
    for (const x of db.prepare("SELECT endpoint FROM gym_push_subs WHERE user = ? ORDER BY created DESC LIMIT -1 OFFSET ?").all(s.user, SUBS_PER_USER))
      db.prepare("DELETE FROM gym_push_subs WHERE endpoint = ?").run(x.endpoint);
    return send(200, { ok: true });
  }
  if (p === "/api/gym/push/unsub" && M === "POST") {
    db.prepare("DELETE FROM gym_push_subs WHERE endpoint = ? AND user = ?").run(String((await json(req)).endpoint || ""), s.user);
    return send(200, { ok: true });
  }
  if (p === "/api/gym/push/test" && M === "POST") {
    const res = await sendTo(db, s.user, { title: "روتین من", body: "یادآورها روشن است. سر ساعت هر برنامه خبرت می‌کنم.", tag: "test", url: "/gym/" });
    if (!res.length) return send(404, { error: "no_sub" });
    return send(200, { ok: res.some(r => r.status >= 200 && r.status < 300), sent: res.length, results: res });
  }
  // the whole coming schedule at once (it replaces the one before): [{at: ms, tag, title, body}]
  if (p === "/api/gym/push/plan" && M === "PUT") {
    const b = await json(req), now = Date.now();
    if (!Array.isArray(b.items)) return send(400, { error: "items" });
    const items = b.items.filter(x => x && Number.isFinite(+x.at) && +x.at > now - 60e3 && +x.at < now + PLAN_DAYS * 864e5 && typeof x.title === "string" && x.title.trim())
      .slice(0, PLAN_MAX).map(x => [Math.round(+x.at), String(x.tag || "").slice(0, 60), x.title.slice(0, 120), String(x.body || "").slice(0, 300)]);
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM gym_push_plan WHERE user = ?").run(s.user);
      const ins = db.prepare("INSERT OR REPLACE INTO gym_push_plan (user, at, tag, title, body) VALUES (?, ?, ?, ?, ?)");
      for (const x of items) ins.run(s.user, ...x);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return send(200, { ok: true, n: items.length, subs: db.prepare("SELECT count(*) AS n FROM gym_push_subs WHERE user = ?").get(s.user).n });
  }

  if (p === "/api/gym/extract" && M === "POST") {
    if (!aiOn()) return send(503, { error: "ai_off" });
    const day = new Date().toISOString().slice(0, 10), k = s.user + " " + day, n = extracts.get(k) || 0;
    if (n >= EXTRACTS_PER_DAY) return send(429, { error: "too_many" });
    let b; try { b = JSON.parse((await body(req, MAX_EXTRACT)).toString("utf8")); } catch (e) { return send(400, { error: "bad json" }); }
    const images = Array.isArray(b.images) ? b.images.filter(u => typeof u === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(u)).slice(0, 6) : [];
    if (!ASK[b.kind] || (!images.length && !String(b.text || "").trim())) return send(400, { error: "input" });
    if (extracts.size > 5000) extracts.clear();
    extracts.set(k, n + 1);
    return send(200, { kind: b.kind, result: await extract(b.kind, b.text, images) });
  }
  if (p === "/api/gym/logout" && M === "POST") { db.prepare("DELETE FROM gym_sessions WHERE token = ?").run(s.token); return send(200, { ok: true }); }

  // the user's whole data as one JSON document; a write names the rev it was based on, a stale one gets 409 + the current copy
  if (p === "/api/gym/data" && M === "GET") {
    const r = db.prepare("SELECT data, rev FROM gym_data WHERE user = ?").get(s.user);
    const since = new URL(req.url, "http://x").searchParams.get("rev");
    if (r && since != null && +since === r.rev) return send(200, { same: true, rev: r.rev });
    return send(200, r ? { rev: r.rev, data: JSON.parse(r.data) } : { rev: 0, data: null });
  }
  if (p === "/api/gym/data" && M === "PUT") {
    const raw = (await body(req, MAX_DATA)).toString("utf8");
    let b; try { b = JSON.parse(raw); } catch (e) { return send(400, { error: "bad json" }); }
    if (!b || typeof b.data !== "object" || b.data === null || Array.isArray(b.data)) return send(400, { error: "data" });
    const cur = db.prepare("SELECT data, rev FROM gym_data WHERE user = ?").get(s.user), rev = cur ? cur.rev : 0;
    if (+b.base !== rev) return send(409, { rev, data: cur ? JSON.parse(cur.data) : null });
    db.prepare("INSERT INTO gym_data (user, data, rev, at) VALUES (?, ?, ?, ?) ON CONFLICT (user) DO UPDATE SET data = excluded.data, rev = excluded.rev, at = excluded.at")
      .run(s.user, JSON.stringify(b.data), rev + 1, Date.now());
    return send(200, { rev: rev + 1 });
  }

  // the user's own files (InBody results, lab tests, diet sheets): images and PDFs only
  const fm = /^\/api\/gym\/file\/([^/]+)$/.exec(p);
  if (fm) {
    if (!FILE_ID.test(fm[1])) return send(400, { error: "id" });
    if (M === "PUT") {
      const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!/^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf)$/.test(type)) return send(415, { error: "type" });
      const bytes = await body(req, MAX_FILE);
      const own = db.prepare("SELECT user FROM gym_files WHERE id = ?").get(fm[1]);
      if (own && own.user !== s.user) return send(409, { error: "id" });
      db.prepare("INSERT INTO gym_files (id, user, type, bytes, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET type = excluded.type, bytes = excluded.bytes, at = excluded.at").run(fm[1], s.user, type, bytes, Date.now());
      return send(200, { ok: true });
    }
    const f = db.prepare("SELECT type, bytes FROM gym_files WHERE id = ? AND user = ?").get(fm[1], s.user);
    if (M === "GET") {
      if (!f) return send(404, { error: "not_found" });
      res.writeHead(200, { "Content-Type": f.type, "Content-Security-Policy": "sandbox; default-src 'none'" });
      return res.end(Buffer.from(f.bytes));
    }
    if (M === "DELETE") { db.prepare("DELETE FROM gym_files WHERE id = ? AND user = ?").run(fm[1], s.user); return send(200, { ok: true }); }
  }

  if (p === "/api/gym/password" && M === "POST") {
    if (blocked("pw " + s.user, 5)) return send(429, { error: "too_many" });
    const b = await json(req), nu = passKey(b.new || "");
    const row = db.prepare("SELECT * FROM gym_users WHERE name = ?").get(s.user);
    if (!check(row, passKey(b.old || ""))) { failed("pw " + s.user); return send(403, { error: "bad_old" }); }
    if (nu.length < 6) return send(400, { error: "short" });
    setPass(db, s.user, nu);
    db.prepare("DELETE FROM gym_sessions WHERE user = ? AND token != ?").run(s.user, s.token); // other devices sign in again
    return send(200, { ok: true });
  }

  // ---------- admin: people who use the app
  if (p.startsWith("/api/gym/users")) {
    if (!admin) return send(403, { error: "admin" });
    if (p === "/api/gym/users" && M === "GET")
      return send(200, { users: db.prepare("SELECT name, role, created FROM gym_users ORDER BY created").all() });
    const b = M === "POST" ? await json(req) : {}, u = nameKey(b.u || "");
    if (p === "/api/gym/users/add" && M === "POST") {
      const pass = passKey(b.p || ""), role = b.role === "admin" ? "admin" : "user";
      if (!NAME.test(u)) return send(400, { error: "name" });
      if (pass.length < 6) return send(400, { error: "short" });
      if (db.prepare("SELECT 1 FROM gym_users WHERE name = ?").get(u)) return send(409, { error: "exists" });
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("INSERT INTO gym_users (name, salt, hash, role, created) VALUES (?, ?, ?, ?, ?)").run(u, salt, scrypt(pass, salt), role, Date.now());
      return send(200, { ok: true, user: u });
    }
    const row = u && db.prepare("SELECT * FROM gym_users WHERE name = ?").get(u);
    if (!row) return send(404, { error: "not_found" });
    if (p === "/api/gym/users/password" && M === "POST") {
      const pass = passKey(b.p || "");
      if (pass.length < 6) return send(400, { error: "short" });
      setPass(db, u, pass); db.prepare("DELETE FROM gym_sessions WHERE user = ?").run(u);
      return send(200, { ok: true });
    }
    if (p === "/api/gym/users/remove" && M === "POST") {
      if (u === s.user) return send(400, { error: "self" });
      for (const t of ["gym_sessions", "gym_data", "gym_files", "gym_push_subs", "gym_push_plan", "gym_food_marks"]) db.prepare(`DELETE FROM ${t} WHERE user = ?`).run(u);
      db.prepare("DELETE FROM gym_users WHERE name = ?").run(u);
      return send(200, { ok: true });
    }
  }
  send(404, { error: "not_found" });
}
