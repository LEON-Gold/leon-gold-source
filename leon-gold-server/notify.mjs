// Push notifications for «حساب من» (Web Push, as iPhones get it from a page added to the home screen, iOS 16.4+).
// A party turns them on in its profile; the server then tells it, on its own lock screen:
//   - a customer: a new piece in «ویترین», and its own order registered or moved to a new step
//   - a supplier (any party picked as an order item's maker): work newly given to it, or a changed due date
// The events come from the ledger's own sync (push() in server.mjs hands over each watched doc before and after).
// Messages for one party within a short window go out as one. Web Push is done here with node:crypto only:
// VAPID (RFC 8292) signs, aes128gcm (RFC 8291) encrypts; the key pair lives in the meta table.
import crypto from "node:crypto";

const OST = { new: "ثبت شد", src: "در حال تهیه", ready: "آماده‌ی تحویل", done: "تحویل شد", cancel: "لغو شد" };
const SUBS_PER_PARTY = 10, DELAY = +(process.env.PUSH_DELAY_MS || 20000);
// only the browsers' own push services: the server never posts to an address a client made up
const HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/,
  ...(process.env.PUSH_TEST_HOST ? [new RegExp("^" + process.env.PUSH_TEST_HOST.replace(/\./g, "\\.") + "$")] : [])];
const b64u = b => Buffer.from(b).toString("base64url");
const faDigits = s => String(s ?? "").replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);

let DB = null, SITE = "", KEY = null, LEDGER = "";
export function setup(db, site) {
  DB = db; SITE = site; LEDGER = process.env.LEDGER_URL || "https://leongold.net/daftar/";
  db.exec(`CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, who TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL)`);
  // the Android app (leon-gold-android) has no Web Push in its WebView and many phones here have no Google push:
  // a device of the app registers here, the party's messages are kept in its inbox, and the app fetches them itself
  db.exec(`CREATE TABLE IF NOT EXISTS app_devices (dev TEXT PRIMARY KEY, who TEXT NOT NULL, created INTEGER NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS app_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT NOT NULL, created INTEGER NOT NULL)`);
  db.exec(`CREATE INDEX IF NOT EXISTS app_inbox_who ON app_inbox (who, id)`);
  // everyone who listens, by either road
  db.exec(`CREATE VIEW IF NOT EXISTS push_who AS SELECT who FROM push_subs UNION SELECT who FROM app_devices`);
  const row = db.prepare("SELECT v FROM meta WHERE k = 'vapid'").get();
  let jwk = row && JSON.parse(row.v);
  if (!jwk) {
    jwk = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
    db.prepare("INSERT INTO meta (k, v) VALUES ('vapid', ?)").run(JSON.stringify(jwk));
  }
  KEY = { priv: crypto.createPrivateKey({ key: jwk, format: "jwk" }), pub: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]) };
}
export const publicKey = () => b64u(KEY.pub);

// ---------- Web Push itself ----------
export function encrypt(payload, p256dh, auth) {
  const ua = Buffer.from(p256dh, "base64url"), secret = Buffer.from(auth, "base64url");
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const as = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head); head.writeUInt32BE(4096, 16); head[20] = as.length;
  return Buffer.concat([head, as, body]);
}
function vapid(endpoint) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const data = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." + b64u(JSON.stringify({ aud, exp: now + 12 * 3600, sub: SITE.startsWith("https:") ? new URL(SITE).origin : "mailto:push@leon-gold.invalid" }));
  return `vapid t=${data}.${b64u(crypto.sign("sha256", Buffer.from(data), { key: KEY.priv, dsaEncoding: "ieee-p1363" }))}, k=${publicKey()}`;
}
// what the push service answered (status, and its reason when it refused), for «اعلان آزمایشی» and the log
async function sendOne(sub, msg) {
  const host = new URL(sub.endpoint).hostname;
  try {
    const r = await fetch(sub.endpoint, { method: "POST", body: encrypt(JSON.stringify(msg), sub.p256dh, sub.auth), signal: AbortSignal.timeout(15000),
      headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal", Authorization: vapid(sub.endpoint) } });
    // a subscription its browser dropped (uninstalled, turned off) is forgotten
    if (r.status === 404 || r.status === 410) DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(sub.endpoint);
    const reason = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
    if (!r.ok) console.error("push", host, r.status, reason);
    return { host, status: r.status, reason };
  } catch (e) { console.error("push", host, "unreachable", e.cause?.code || e.message); return { host, status: 0, reason: String(e.cause?.code || e.name || e.message) }; }
}
// can this server reach the push services at all (some may not answer servers in Iran): any HTTP answer counts as reachable
let reachAt = 0, reachMemo = null;
export async function reach() {
  if (reachMemo && Date.now() - reachAt < 60000) return reachMemo;
  const one = async u => { try { return (await fetch(u, { method: "POST", signal: AbortSignal.timeout(10000) })).status; } catch (e) { return "unreachable " + (e.cause?.code || e.name); } };
  const [apple, google] = await Promise.all([one("https://web.push.apple.com/"), one("https://fcm.googleapis.com/fcm/send/x")]);
  reachAt = Date.now(); return (reachMemo = { apple, google });
}
const okEndpoint = u => { try { const x = new URL(u); return (x.protocol === "https:" || !!process.env.PUSH_TEST_HOST) && HOSTS.some(h => h.test(x.hostname)); } catch { return false; } };

// ---------- who gets what: messages wait a moment so a burst (ten new pieces) becomes one ----------
const queue = new Map();
const partyOn = id => { const r = DB.prepare("SELECT data FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(id); return !!r && JSON.parse(r.data).portalOff !== true; };
function tell(partyId, m) {
  if (!DB.prepare("SELECT 1 FROM push_who WHERE who = ? LIMIT 1").get("party:" + partyId)) return;
  const q = queue.get(partyId) || { list: [], timer: null };
  q.list.push(m); queue.set(partyId, q);
  if (!q.timer) q.timer = setTimeout(() => flush(partyId), DELAY);
}
// (owner, 2026-11-14) the reminders to set one's own password and fill in one's details (portal.mjs nudges)
export const tellParty = (partyId, m) => tell(partyId, m);
export async function flush(partyId) {
  const q = queue.get(partyId); queue.delete(partyId);
  if (!q || !q.list.length || !partyOn(partyId)) return;
  const l = q.list, msg = l.length === 1 ? l[0] : { title: "لئون گلد", body: faDigits(l.length) + " خبر تازه: " + l.map(m => m.body).join("؛ "), tab: l.every(m => m.tab === l[0].tab) ? l[0].tab : "home" };
  msg.url = SITE + "hesab/" + (msg.tab && msg.tab !== "home" ? "?t=" + msg.tab : "");
  for (const s of DB.prepare("SELECT * FROM push_subs WHERE who = ?").all("party:" + partyId)) await sendOne(s, msg);
  keep("party:" + partyId, msg);
}
// the app's inbox: only for a party with an app device; the last INBOX_KEEP messages, none older than INBOX_DAYS
const INBOX_KEEP = 50, INBOX_DAYS = 14;
function keep(who, msg) {
  if (!DB.prepare("SELECT 1 FROM app_devices WHERE who = ? LIMIT 1").get(who)) return;
  DB.prepare("INSERT INTO app_inbox (who, title, body, url, created) VALUES (?, ?, ?, ?, ?)").run(who, String(msg.title).slice(0, 200), String(msg.body).slice(0, 1000), String(msg.url || SITE + "hesab/"), Date.now());
  DB.prepare("DELETE FROM app_inbox WHERE who = ? AND (created < ? OR id NOT IN (SELECT id FROM app_inbox WHERE who = ? ORDER BY id DESC LIMIT ?))").run(who, Date.now() - INBOX_DAYS * 864e5, who, INBOX_KEEP);
}
const lastId = who => DB.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM app_inbox WHERE who = ?").get(who).n;
export const pending = () => [...queue.keys()];

// the ledger's watched docs, before and after one sync (null when there was none or it was deleted)
export function changed(list) {
  for (const { c, before: a, after: b } of list) {
    if (!b) continue;
    if (c === "vitrin") {
      // news to each party that sees it now and did not before (newly shown, or newly added to whom it is shown)
      const sees = (x, id) => !!x && x.show !== false && !x.pending && !!x.name && (!Array.isArray(x.to) || !x.to.length || x.to.includes(id));
      for (const r of DB.prepare("SELECT DISTINCT who FROM push_who WHERE who LIKE 'party:%'").all()) {
        const id = r.who.slice(6);
        if (sees(b, id) && !sees(a, id)) tell(id, { title: "ویترین لئون گلد", body: "کار تازه: " + b.name, tab: "vitrin" });
      }
    }
    if (c === "orders") {
      const what = (b.items || []).map(i => i.desc).filter(Boolean).join("، ") || "سفارش";
      if (b.partyId && b.status !== "cancel") {
        if (!a) tell(b.partyId, { title: "سفارش شما ثبت شد", body: what, tab: "orders" });
        else if (a.status !== b.status && OST[b.status]) tell(b.partyId, { title: "سفارش شما: " + OST[b.status], body: what, tab: "orders" });
      }
      if (b.status === "done" || b.status === "cancel") continue;
      const had = new Set((a?.items || []).map(i => i.supId).filter(Boolean));
      const bySup = {};
      for (const i of b.items || []) if (i.supId) (bySup[i.supId] ||= []).push(i.desc || "قلم سفارش");
      for (const [sup, items] of Object.entries(bySup)) {
        if (!had.has(sup)) tell(sup, { title: "کار تازه به شما سپرده شد", body: items.join("، ") + (b.due ? " · موعد " + b.due : ""), tab: "orders" });
        else if (a && a.due !== b.due && b.due) tell(sup, { title: "موعد کار تغییر کرد", body: items.join("، ") + " · موعد تازه " + b.due, tab: "orders" });
      }
    }
  }
}

// ---------- the party's own switch, from «حساب من» (its portal session) ----------
export async function handle(req, p, who, { send, json }) {
  if (p === "/api/portal/push/key" && req.method === "GET") return send(200, { key: publicKey() });
  if (p === "/api/portal/push/reach" && req.method === "GET") return send(200, await reach());
  if (!who) return send(401, { error: "login" });
  const b = req.method === "POST" ? await json(req) : {};
  if (p === "/api/portal/push/sub" && req.method === "POST") {
    const ep = String(b.endpoint || ""), k = b.keys || {};
    if (!okEndpoint(ep) || !/^[\w-]{80,100}$/.test(k.p256dh || "") || !/^[\w-]{16,32}$/.test(k.auth || "")) return send(400, { error: "bad_sub" });
    DB.prepare("INSERT INTO push_subs (endpoint, who, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET who = excluded.who, p256dh = excluded.p256dh, auth = excluded.auth")
      .run(ep, who, k.p256dh, k.auth, Date.now());
    const extra = DB.prepare("SELECT endpoint FROM push_subs WHERE who = ? ORDER BY created DESC LIMIT -1 OFFSET ?").all(who, SUBS_PER_PARTY);
    for (const x of extra) DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").run(x.endpoint);
    return send(200, { ok: true });
  }
  // the Android app: register this device (a random id the app made), fetch what came after the last one it showed, or stop
  if (p === "/api/portal/push/app" && req.method === "POST") {
    const dev = String(b.dev || "");
    if (!/^[\w-]{16,64}$/.test(dev)) return send(400, { error: "bad_dev" });
    DB.prepare("INSERT INTO app_devices (dev, who, created) VALUES (?, ?, ?) ON CONFLICT (dev) DO UPDATE SET who = excluded.who").run(dev, who, Date.now());
    const extra = DB.prepare("SELECT dev FROM app_devices WHERE who = ? ORDER BY created DESC LIMIT -1 OFFSET ?").all(who, SUBS_PER_PARTY);
    for (const x of extra) DB.prepare("DELETE FROM app_devices WHERE dev = ?").run(x.dev);
    return send(200, { ok: true, last: lastId(who) });
  }
  if (p === "/api/portal/push/app/off" && req.method === "POST") {
    DB.prepare("DELETE FROM app_devices WHERE dev = ? AND who = ?").run(String(b.dev || ""), who);
    return send(200, { ok: true });
  }
  if (p === "/api/portal/push/inbox" && req.method === "GET") {
    const after = Math.max(0, parseInt(new URL(req.url, "http://x").searchParams.get("after"), 10) || 0);
    const items = DB.prepare("SELECT id, title, body, url FROM app_inbox WHERE who = ? AND id > ? ORDER BY id LIMIT 20").all(who, after);
    return send(200, { items, last: items.length ? items[items.length - 1].id : Math.max(after, lastId(who)) });
  }
  if (p === "/api/portal/push/unsub" && req.method === "POST") {
    DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND who = ?").run(String(b.endpoint || ""), who);
    return send(200, { ok: true });
  }
  // «اعلان آزمایشی»: straight away, to this party's own devices
  if (p === "/api/portal/push/test" && req.method === "POST") {
    const subs = DB.prepare("SELECT * FROM push_subs WHERE who = ?").all(who);
    if (!subs.length) return send(404, { error: "no_sub" });
    const res = [];
    for (const s of subs) res.push(await sendOne(s, { title: "لئون گلد", body: "اعلان‌های «حساب من» روشن است.", url: SITE + "hesab/" }));
    return send(200, { ok: res.some(r => r.status >= 200 && r.status < 300), sent: res.length, results: res });
  }
  return send(404, { error: "not_found" });
}
// ---------- the ledger's own users («دفتر لئون», owner 2026-11-09: "همه چی رو بهم ناتیف بده") ----------
// Each device signed in to the ledger subscribes as "ledger:<its ledger user>". Every save, edit or delete in a section
// reaches the other ledger users who may open that section (their «محدودیت» in settings/lock), never the one who made it
// (the ledger's own change log in the same sync names who did). A new order from «حساب من» (crm_leads) reaches everyone
// who sees «سفارشات». A burst (an import, ten lines) goes out as one message.
const SEC = { invoices: "invoices", settlements: "settlements", orders: "orders", expenses: "expenses", parties: "parties", products: "products", vitrin: "vitrin", targets: "targets", crm_leads: "orders", signups: "parties" };
export const LEDGER_COLS = Object.keys(SEC);
export const normU = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/\s+/g, " ").trim().toLowerCase();
function ledgerUsers() {
  const r = DB.prepare("SELECT data FROM docs WHERE col = 'settings' AND id = 'lock' AND data IS NOT NULL").get();
  const u = r ? JSON.parse(r.data).users : null;
  return Array.isArray(u) ? u : [];
}
function mayHear(U, name, col) {
  if (!U.length) return true;
  const rec = U.find(x => normU(x.u) === name);
  return !!rec && (!Array.isArray(rec.perms) || rec.perms.includes(SEC[col]));
}
const INV = d => d.kind === "whole" ? (d.doc === "rc" ? "سند دریافتی عمده" : "فاکتور عمده") : "فاکتور خرده";
function label(c, d) {
  const items = d => (d.items || []).map(i => i.desc).filter(Boolean).join("، ");
  const L = {
    invoices: () => [INV(d) + (d.no ? " " + d.no : ""), d.partyName],
    settlements: () => ["سند تسویه", d.partyName],
    orders: () => ["سفارش", d.partyName, items(d)],
    expenses: () => ["هزینه", d.note],
    parties: () => ["طرف‌حساب", d.name],
    products: () => ["کالا", d.name],
    vitrin: () => ["ویترین", d.name],
    targets: () => ["تارگت", d.title],
  }[c];
  return faDigits((L ? L() : [c]).filter(Boolean).join(" · "));
}
const lqueue = new Map();
function tellLedger(m, col, by, now) {
  const U = ledgerUsers(), me = normU(by);
  for (const r of DB.prepare("SELECT DISTINCT who FROM push_subs WHERE who LIKE 'ledger:%'").all()) {
    const name = r.who.slice(7);
    if (by && name === me) continue;
    if (!mayHear(U, name, col)) continue;
    const q = lqueue.get(r.who) || { list: [], timer: null };
    q.list.push(m); lqueue.set(r.who, q);
    if (now) { clearTimeout(q.timer); q.timer = setTimeout(() => flushLedger(r.who), 300); }
    else if (!q.timer) q.timer = setTimeout(() => flushLedger(r.who), DELAY);
  }
}
// to the owner only: ledger users with no limit on what they see (or everyone, when the ledger has no user list)
export function tellOwners(m, col) {
  const U = ledgerUsers();
  for (const r of DB.prepare("SELECT DISTINCT who FROM push_subs WHERE who LIKE 'ledger:%'").all()) {
    const name = r.who.slice(7), rec = U.find(x => normU(x.u) === name);
    if (U.length && !(rec && !Array.isArray(rec.perms))) continue;
    const q = lqueue.get(r.who) || { list: [], timer: null };
    q.list.push(m); lqueue.set(r.who, q); clearTimeout(q.timer); q.timer = setTimeout(() => flushLedger(r.who), 300);
  }
}
export async function flushLedger(who) {
  const q = lqueue.get(who); lqueue.delete(who);
  if (!q || !q.list.length) return;
  const l = q.list, more = l.length > 6 ? " و " + faDigits(l.length - 6) + " مورد دیگر" : "";
  const msg = l.length === 1 ? l[0] : { title: "دفتر لئون · " + faDigits(l.length) + " خبر تازه", body: l.slice(0, 6).map(m => m.body).join("؛ ") + more };
  msg.url = LEDGER;
  for (const s of DB.prepare("SELECT * FROM push_subs WHERE who = ?").all(who)) await sendOne(s, msg);
}
// one sync's watched docs (before and after) and the ledger's change-log rows that came with it
export function ledger(list, logs, who) {
  const byDoc = {};
  for (const g of logs || []) if (g && g.docId) byDoc[g.col + "/" + g.docId] = g.by || "";
  for (const { c, id, before: a, after: b } of list) {
    if (!SEC[c]) continue;
    if (c === "signups") {
      if (!a && b) tellLedger({ title: "ثبت‌نام تازه در «حساب من»", body: faDigits([b.fullName, b.mobile, b.bizName || (b.kind === "supplier" ? "همکار / تأمین‌کننده" : "مشتری")].filter(Boolean).join(" · ")) + (b.status === "pending" ? " · منتظر تایید شما" : b.group === "colleague" ? " · ادعای همکاری؛ بررسی کنید" : "") }, c, "");
      continue;
    }
    if (c === "crm_leads") {
      if (!a && b) tellLedger({ title: b.status === "waiting" ? "سفارش تازه · ۱۲۰ ثانیه برای تایید" : b.source === "سایت" ? "سفارش تازه از سایت" : "سفارش تازه از «حساب من»",
        body: faDigits([b.name, b.source === "سایت" ? b.phone : "", b.what, b.note].filter(Boolean).join(" · ")) }, c, "", b.status === "waiting");
      continue;
    }
    if (!a && !b) continue;
    if (who === "portal" || who === "system") continue; // a party made by a sign-up (the «signups» message says it), or a one-time fix
    const by = byDoc[c + "/" + id] || "";
    let verb = !a ? "ثبت تازه" : !b ? "حذف شد" : "ویرایش";
    if (c === "orders" && a && b && a.status !== b.status && OST[b.status]) verb = "سفارش " + OST[b.status];
    tellLedger({ title: "دفتر لئون · " + verb, body: label(c, b || a) + (by ? " — " + by : "") }, c, by);
  }
}
export async function handleLedger(req, p, { send, json }) {
  if (p === "/api/notify/key" && req.method === "GET") return send(200, { key: publicKey() });
  const b = req.method === "POST" ? await json(req) : {};
  const who = "ledger:" + normU(b.u).slice(0, 40);
  if (p === "/api/notify/sub" && req.method === "POST") {
    const ep = String(b.endpoint || ""), k = b.keys || {};
    if (!okEndpoint(ep) || !/^[\w-]{80,100}$/.test(k.p256dh || "") || !/^[\w-]{16,32}$/.test(k.auth || "")) return send(400, { error: "bad_sub" });
    DB.prepare("INSERT INTO push_subs (endpoint, who, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET who = excluded.who, p256dh = excluded.p256dh, auth = excluded.auth")
      .run(ep, who, k.p256dh, k.auth, Date.now());
    return send(200, { ok: true });
  }
  if (p === "/api/notify/unsub" && req.method === "POST") {
    DB.prepare("DELETE FROM push_subs WHERE endpoint = ? AND who LIKE 'ledger:%'").run(String(b.endpoint || ""));
    return send(200, { ok: true });
  }
  if (p === "/api/notify/test" && req.method === "POST") {
    const s = DB.prepare("SELECT * FROM push_subs WHERE endpoint = ? AND who LIKE 'ledger:%'").get(String(b.endpoint || ""));
    if (!s) return send(404, { error: "no_sub" });
    const r = await sendOne(s, { title: "دفتر لئون", body: "اعلان‌های دفتر روی این دستگاه روشن است.", url: LEDGER });
    return send(200, { ok: r.status >= 200 && r.status < 300, result: r });
  }
  return send(404, { error: "not_found" });
}

// a party signed out everywhere (new password, removed login, switched off) stops getting them too
export const forget = who => { if (!DB) return; for (const t of ["push_subs", "app_devices", "app_inbox"]) DB.prepare(`DELETE FROM ${t} WHERE who = ?`).run(who); };
// «روتین من» (gym.mjs) sends its own reminders with the same keys, to subscriptions it keeps in its own table
export { sendOne as sendPush, okEndpoint };
