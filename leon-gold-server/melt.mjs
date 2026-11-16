// «خرید و فروش آبشده» (owner, 2026-11-16): colleagues buy and sell melt, the 18-carat gram, coins and silver bars in
// «حساب من» at the melt seller's live price plus the owner's margin. Every trade the owner approves is placed again, the
// same side and amount, on the owner's own account at that seller (supplier.mjs), and only when the seller confirms it
// does the colleague's trade stand. It then goes at once to the ledger's «سند موقت» (collection tempdocs), which the
// owner turns into an invoice the next day.
//
// Money is whole rials; quantities are kept ×1000 (qm) so 2.5 mithqal is 2500 and nothing is a float.
// One order, one row in melt_orders, and one way through it:
//   waiting ──(the colleague cancels)──────────────→ cancelled
//      │ ────(the owner rejects)─────────────────→ rejected
//      │ ────(120 s pass)────────────────────────→ expired
//      │ ────(the owner approves at the locked price)→ placing ──→ done (tempdocs) | failed | unknown
// While waiting the seller's price may move: the colleague is shown the new price and total and must accept it
// (that relocks the price); the owner's approval is refused until the locked price is the live one again.
// "placing" is set in the same statement that checks "waiting", so one order can never be placed twice. An answer from
// the seller that never comes leaves it "unknown": the owner checks the seller's app by hand and settles it.
import crypto from "node:crypto";
import * as supplier from "./supplier.mjs";
import * as portal from "./portal.mjs";

export const WAIT_S = +(process.env.MELT_WAIT_S || 120);
export const MQ = 4.3318;                       // grams of 18-carat in a mithqal (the site and the ledger use the same)
const PLACE_MS = +(process.env.MELT_PLACE_MS || 15000);
const QUOTE_MS = +(process.env.MELT_QUOTE_MS || 8000);

// the items, in the order shown; fx: the ledger's currency/coin unit an invoice moves; g: grams of 750 per unit
export const ITEMS = [
  { k: "m1", name: "آبشده مثقال · نقد فردا", unit: "مثقال", dec: 3, grp: "melt", g: MQ },
  { k: "m2", name: "آبشده مثقال · نقد پس‌فردا", unit: "مثقال", dec: 3, grp: "melt", g: MQ },
  { k: "g18", name: "گرم ۱۸ · نقد فردا", unit: "گرم", dec: 3, grp: "gram", g: 1 },
  { k: "c1", name: "سکه تمام ۸۶", unit: "عدد", dec: 0, grp: "coin", fx: "cn" },
  { k: "c2", name: "نیم سکه ۸۶", unit: "عدد", dec: 0, grp: "coin", fx: "ch" },
  { k: "c4", name: "ربع سکه ۸۶", unit: "عدد", dec: 0, grp: "coin", fx: "cq" },
  { k: "s1", name: "شمش نقره ۱۰۰۰ گرمی", unit: "عدد", dec: 0, grp: "silver", fx: "ag" },
  { k: "s2", name: "شمش نقره ۱۰۰۰ گرمی (نوع دوم)", unit: "عدد", dec: 0, grp: "silver", fx: "ag" },
];
export const GROUPS = [["melt", "آبشده مثقال"], ["gram", "آبشده گرمی"], ["coin", "سکه‌های ۸۶"], ["silver", "شمش نقره"]];
const itemOf = k => ITEMS.find(x => x.k === k) || null;

export function setup(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS melt_orders (
    id TEXT PRIMARY KEY, party TEXT NOT NULL, pname TEXT, item TEXT NOT NULL, side TEXT NOT NULL, qm INTEGER NOT NULL,
    unit INTEGER NOT NULL, total INTEGER NOT NULL, sup INTEGER NOT NULL, margin INTEGER NOT NULL,
    status TEXT NOT NULL, created INTEGER NOT NULL, exp INTEGER NOT NULL, at INTEGER NOT NULL,
    sup_ref TEXT, sup_price INTEGER, err TEXT, by TEXT)`);
  db.exec("CREATE INDEX IF NOT EXISTS melt_orders_party ON melt_orders (party, created)");
  db.exec("CREATE INDEX IF NOT EXISTS melt_orders_status ON melt_orders (status, created)");
  // every step of every order, never rewritten: who, when, what price (the trail behind each trade)
  db.exec(`CREATE TABLE IF NOT EXISTS melt_log (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, at INTEGER NOT NULL, what TEXT NOT NULL, data TEXT)`);
}
const log = (db, id, what, data) => db.prepare("INSERT INTO melt_log (id, at, what, data) VALUES (?, ?, ?, ?)").run(id, Date.now(), what, data ? JSON.stringify(data) : null);

// ---------- the owner's settings (ledger doc settings/melt) ----------
// { on, msg, items: { m1: { on, m }, … } } with m the margin in TOMAN per unit (the owner's own words: «مثقالی ۵۰ هزار
// تومان»); the 18-carat gram takes the mithqal's margin ÷ 4.3318 (m1's, or m2's when m1 has none)
export function settings(db) {
  const r = db.prepare("SELECT data FROM docs WHERE col = 'settings' AND id = 'melt' AND data IS NOT NULL").get();
  let s = {}; try { s = r ? JSON.parse(r.data) || {} : {}; } catch { s = {}; }
  const it = s.items && typeof s.items === "object" ? s.items : {};
  const tm = v => { const n = Math.round(+v || 0); return n > 0 && n < 1e9 ? n : 0; };
  const items = {};
  for (const x of ITEMS) { const o = it[x.k] || {}; items[x.k] = { on: o.on === true, m: tm(o.m), name: String(o.name || "").trim().slice(0, 60) || x.name }; }
  const mq = items.m1.m || items.m2.m;
  items.g18.m = mq ? Math.round(mq / MQ) : 0;      // toman per gram, derived; whatever was typed for g18 is not used
  return { on: s.on === true, msg: String(s.msg || "").slice(0, 3000), items };
}
// margin in rial per unit
const marginR = (S, k) => S.items[k].m * 10;

// ---------- prices ----------
let sup = supplier.make(), cache = null;
export function useSupplier(s) { sup = s; cache = null; }
// the seller's prices, at most 2 s old (every colleague's page asks; the seller is asked once)
export async function quote() {
  if (cache && Date.now() - cache.got < 2000) return cache.q;
  let q;
  try { q = await supplier.within(sup.quote(), QUOTE_MS); } catch { cache = { got: Date.now(), q: null }; return null; }
  if (!q || typeof q !== "object" || !q.items) { cache = { got: Date.now(), q: null }; return null; }
  cache = { got: Date.now(), q };
  return q;
}
// a colleague's price for one item and side: the seller's ask + margin to buy, its bid − margin to sell; null when
// the item is off, has no price, or the margin would cross zero
export function priceOf(S, q, k, side) {
  const x = itemOf(k), st = S.items[k], p = q && q.items && q.items[k];
  if (!x || !st || !st.on || !p || p.ok === false) return null;
  const bid = Math.round(+p.bid || 0), ask = Math.round(+p.ask || 0);
  if (!(bid > 0 && ask > 0 && ask >= bid)) return null;
  const m = marginR(S, k);
  if (side === "buy") return { unit: ask + m, sup: ask, margin: m };
  if (side === "sell") { const u = bid - m; return u > 0 ? { unit: u, sup: bid, margin: m } : null; }
  return null;
}
export const totalOf = (unit, qm) => Math.round(unit * qm / 1000);

// "2.5" / "۲٫۵" / "2,5" → 2500; null when it is not a plain positive number with at most `dec` decimals
export function qtyIn(v, dec) {
  const s = String(v ?? "").trim().replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٫,]/g, ".");
  const m = /^(\d{1,6})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] || "").replace(/0+$/, "");
  if (frac.length > dec) return null;
  const qm = +m[1] * 1000 + +(frac + "000").slice(0, 3);
  return qm > 0 ? qm : null;
}

// ---------- orders ----------
const row = (db, id) => db.prepare("SELECT * FROM melt_orders WHERE id = ?").get(id) || null;
// a waiting order past its time becomes expired (checked whenever it is read)
function fresh(db, r) {
  if (r && r.status === "waiting" && Date.now() > r.exp) {
    const u = db.prepare("UPDATE melt_orders SET status = 'expired', at = ? WHERE id = ? AND status = 'waiting'").run(Date.now(), r.id);
    if (u.changes) log(db, r.id, "expired");
    return row(db, r.id);
  }
  return r;
}
const left = r => r.status === "waiting" ? Math.max(0, Math.ceil((r.exp - Date.now()) / 1000)) : 0;
// what a page is told about an order; with the live price when it moved while waiting
function view(r, live) {
  const x = itemOf(r.item);
  const o = { id: r.id, item: r.item, name: x ? x.name : r.item, unitName: x ? x.unit : "", side: r.side, qm: r.qm, unit: r.unit, total: r.total,
    status: r.status, left: left(r), created: r.created };
  if (r.status === "waiting" && live && live.unit !== r.unit) o.changed = { unit: live.unit, total: totalOf(live.unit, r.qm) };
  if (r.status === "waiting" && !live) o.noPrice = true;
  return o;
}
const tehranDay = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });

// the approved trade in the ledger's «سند موقت»: everything the next day's invoice needs, nothing about the seller's key
function tempDoc(r, party, res) {
  const x = itemOf(r.item);
  return { kind: "melt", order: r.id, partyId: r.party, partyName: party ? party.name || "" : r.pname || "", item: r.item, itemName: x.name,
    grp: x.grp, fx: x.fx || "", g: x.g || 0, side: r.side, qm: r.qm, qty: r.qm / 1000, unitName: x.unit, unit: r.unit, total: r.total,
    sup: r.sup, margin: r.margin, supRef: String(res.ref || "").slice(0, 120), supPrice: Math.round(+res.price || r.sup),
    day: tehranDay(Date.now()), ts: new Date().toISOString(), reg: "" };
}

// ---------- requests ----------
// «حساب من» (a colleague): /api/portal/melt…
export async function handlePortal(db, req, p, { send, json, tooMany, tellOwners }) {
  const pid = portal.partyOf(db, req);
  if (!pid) return send(401, { error: "login" });
  const party = portal.partyDoc(db, pid);
  if (!portal.isColleague(db, party)) return send(403, { error: "colleagues_only" });
  const S = settings(db);
  const POST = req.method === "POST";

  if (p === "/api/portal/melt" && req.method === "GET") {
    if (!S.on) return send(200, { on: false });
    const q = await quote();
    const items = ITEMS.filter(x => S.items[x.k].on).map(x => {
      const b = priceOf(S, q, x.k, "buy"), s = priceOf(S, q, x.k, "sell");
      return { k: x.k, name: S.items[x.k].name, unit: x.unit, dec: x.dec, grp: x.grp, buy: b ? b.unit : null, sell: s ? s.unit : null };
    });
    return send(200, { on: true, msg: S.msg, at: q ? q.at || Date.now() : null, ok: !!q, wait: WAIT_S, groups: GROUPS, items });
  }

  if (p === "/api/portal/melt/order" && POST) {
    if (!S.on) return send(409, { error: "off" });
    if (tooMany("melt-order:" + pid, 60, 3600e3)) return send(429, { error: "too_many" });
    // one order at a time per colleague: the owner approves them one by one
    const open = db.prepare("SELECT * FROM melt_orders WHERE party = ? AND status = 'waiting'").all(pid).map(r => fresh(db, r)).filter(r => r.status === "waiting");
    if (open.length) return send(409, { error: "one_open", id: open[0].id });
    const b = await json(req), x = itemOf(String(b.k || "")), side = b.side === "buy" || b.side === "sell" ? b.side : "";
    if (!x || !S.items[x.k].on || !side) return send(400, { error: "bad_item" });
    const qm = qtyIn(b.qty, x.dec);
    if (!qm) return send(400, { error: "bad_qty" });
    const q = await quote(), pr = priceOf(S, q, x.k, side);
    if (!pr) return send(409, { error: "no_price" });
    // the price the colleague saw must still be the price; otherwise it is shown the new one first
    if (Math.round(+b.unit || 0) !== pr.unit) return send(409, { error: "price_changed", unit: pr.unit, total: totalOf(pr.unit, qm) });
    const id = "mo" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), now = Date.now(), total = totalOf(pr.unit, qm);
    db.prepare(`INSERT INTO melt_orders (id, party, pname, item, side, qm, unit, total, sup, margin, status, created, exp, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`).run(id, pid, party.name || "", x.k, side, qm, pr.unit, total, pr.sup, pr.margin, now, now + WAIT_S * 1000, now);
    log(db, id, "ordered", { side, qm, unit: pr.unit, total, sup: pr.sup });
    try { tellOwners({ title: "آبشده · " + WAIT_S + " ثانیه برای تایید", body: (party.name || "همکار") + " · " + (side === "buy" ? "خرید " : "فروش ") + qm / 1000 + " " + x.unit + " " + x.name, tag: "melt" }, "melt"); } catch (e) { console.error("melt tell", e.message); }
    return send(200, { ok: true, order: view(row(db, id), pr) });
  }

  const om = /^\/api\/portal\/melt\/order\/(mo[a-z0-9]{6,40})(\/accept|\/cancel)?$/.exec(p);
  if (om) {
    let r = row(db, om[1]);
    if (!r || r.party !== pid) return send(404, { error: "not_found" });
    r = fresh(db, r);
    if (!om[2] && req.method === "GET") {
      const live = r.status === "waiting" ? priceOf(S, await quote(), r.item, r.side) : null;
      return send(200, { order: view(r, live) });
    }
    if (om[2] === "/cancel" && POST) {
      const u = db.prepare("UPDATE melt_orders SET status = 'cancelled', at = ? WHERE id = ? AND status = 'waiting'").run(Date.now(), r.id);
      if (!u.changes) return send(409, { error: "not_waiting", order: view(row(db, r.id)) });
      log(db, r.id, "cancelled");
      return send(200, { ok: true, order: view(row(db, r.id)) });
    }
    // the colleague takes the new price: it is locked only if it is still the live one
    if (om[2] === "/accept" && POST) {
      if (r.status !== "waiting") return send(409, { error: "not_waiting", order: view(r) });
      const b = await json(req), live = priceOf(S, await quote(), r.item, r.side);
      if (!live) return send(409, { error: "no_price" });
      if (Math.round(+b.unit || 0) !== live.unit) return send(409, { error: "price_changed", order: view(r, live) });
      const total = totalOf(live.unit, r.qm);
      const u = db.prepare("UPDATE melt_orders SET unit = ?, total = ?, sup = ?, margin = ?, at = ? WHERE id = ? AND status = 'waiting'").run(live.unit, total, live.sup, live.margin, Date.now(), r.id);
      if (!u.changes) return send(409, { error: "not_waiting", order: view(row(db, r.id)) });
      log(db, r.id, "accepted", { unit: live.unit, total, sup: live.sup });
      return send(200, { ok: true, order: view(row(db, r.id), live) });
    }
  }
  return send(404, { error: "not_found" });
}

// the ledger (owner session): /api/melt…
export async function handleOwner(db, req, p, { send, json, push, who }) {
  const S = settings(db), POST = req.method === "POST";
  if (p === "/api/melt/orders" && req.method === "GET") {
    const q = await quote();
    const L = db.prepare("SELECT * FROM melt_orders ORDER BY created DESC LIMIT 60").all().map(r => fresh(db, r));
    return send(200, { ok: !!q, at: q ? q.at || null : null, orders: L.map(r => ({ ...view(r, r.status === "waiting" ? priceOf(S, q, r.item, r.side) : null), party: r.party, pname: r.pname, err: r.err || "", supRef: r.sup_ref || "" })) });
  }
  // the seller's prices next to the colleagues' (for the margins page); never anything about the key
  if (p === "/api/melt/prices" && req.method === "GET") {
    const q = await quote();
    return send(200, { ok: !!q, at: q ? q.at || null : null, items: ITEMS.map(x => {
      const qp = q && q.items && q.items[x.k], b = priceOf(S, q, x.k, "buy"), s = priceOf(S, q, x.k, "sell");
      return { k: x.k, name: S.items[x.k].name, unit: x.unit, on: S.items[x.k].on, m: S.items[x.k].m, bid: qp ? Math.round(+qp.bid || 0) : null, ask: qp ? Math.round(+qp.ask || 0) : null, buy: b ? b.unit : null, sell: s ? s.unit : null };
    }) });
  }
  if (p === "/api/melt/reject" && POST) {
    const b = await json(req), r = fresh(db, row(db, String(b.id || "")));
    if (!r) return send(404, { error: "not_found" });
    const u = db.prepare("UPDATE melt_orders SET status = 'rejected', at = ?, by = ? WHERE id = ? AND status = 'waiting'").run(Date.now(), who, r.id);
    if (!u.changes) return send(409, { error: "not_waiting", status: r.status });
    log(db, r.id, "rejected", { by: who });
    return send(200, { ok: true });
  }
  if (p === "/api/melt/approve" && POST) {
    const b = await json(req), r0 = fresh(db, row(db, String(b.id || "")));
    if (!r0) return send(404, { error: "not_found" });
    if (r0.status !== "waiting") return send(409, { error: "not_waiting", status: r0.status });
    // the live price must be the locked one: if it moved, the colleague is asked first (and the owner sees why)
    const live = priceOf(S, await quote(), r0.item, r0.side);
    if (!live) return send(409, { error: "no_price" });
    if (live.unit !== r0.unit) { log(db, r0.id, "approve_moved", { unit: r0.unit, live: live.unit }); return send(409, { error: "price_changed", order: view(r0, live) }); }
    // the one step that claims the order: only one approval can ever get past here
    const claim = db.prepare("UPDATE melt_orders SET status = 'placing', at = ?, by = ? WHERE id = ? AND status = 'waiting' AND exp >= ?").run(Date.now(), who, r0.id, Date.now());
    if (!claim.changes) { const r = fresh(db, row(db, r0.id)); return send(409, { error: "not_waiting", status: r.status }); }
    log(db, r0.id, "placing", { by: who, unit: r0.unit, sup: live.sup });
    const r = row(db, r0.id);
    let res;
    try { res = await supplier.within(sup.place({ k: r.item, side: r.side, qm: r.qm, ref: r.id, price: live.sup }), PLACE_MS); }
    catch (e) {
      const err = e && e.message === "timeout" ? "timeout" : "no_answer";
      db.prepare("UPDATE melt_orders SET status = 'unknown', err = ?, at = ? WHERE id = ?").run(err, Date.now(), r.id);
      log(db, r.id, "unknown", { err });
      return send(502, { error: "unknown", order: view(row(db, r.id)) });
    }
    if (!res || res.ok !== true) {
      const err = supplier.errWord(res && res.err);
      db.prepare("UPDATE melt_orders SET status = 'failed', err = ?, at = ? WHERE id = ?").run(err, Date.now(), r.id);
      log(db, r.id, "failed", { err });
      return send(409, { error: "failed", reason: err, order: view(row(db, r.id)) });
    }
    const party = portal.partyDoc(db, r.party);
    db.prepare("UPDATE melt_orders SET status = 'done', sup_ref = ?, sup_price = ?, at = ? WHERE id = ?").run(String(res.ref || "").slice(0, 120), Math.round(+res.price || live.sup), Date.now(), r.id);
    const done = row(db, r.id), d = tempDoc(done, party, res);
    push([{ c: "tempdocs", id: "t" + r.id, d }], "melt");
    log(db, r.id, "done", { ref: d.supRef, supPrice: d.supPrice });
    return send(200, { ok: true, order: view(done), temp: "t" + r.id });
  }
  // an "unknown" one, after the owner looked in the seller's app: it was placed (→ done, into «سند موقت») or it was not
  if (p === "/api/melt/resolve" && POST) {
    const b = await json(req), r = row(db, String(b.id || ""));
    if (!r) return send(404, { error: "not_found" });
    if (r.status !== "unknown") return send(409, { error: "not_unknown", status: r.status });
    if (b.placed === true) {
      const u = db.prepare("UPDATE melt_orders SET status = 'done', sup_ref = ?, at = ? WHERE id = ? AND status = 'unknown'").run("دستی", Date.now(), r.id);
      if (!u.changes) return send(409, { error: "not_unknown" });
      const party = portal.partyDoc(db, r.party);
      push([{ c: "tempdocs", id: "t" + r.id, d: tempDoc(row(db, r.id), party, { ref: "دستی", price: r.sup }) }], "melt");
      log(db, r.id, "resolved_done", { by: who });
    } else {
      const u = db.prepare("UPDATE melt_orders SET status = 'failed', err = 'not_placed', at = ? WHERE id = ? AND status = 'unknown'").run(Date.now(), r.id);
      if (!u.changes) return send(409, { error: "not_unknown" });
      log(db, r.id, "resolved_failed", { by: who });
    }
    return send(200, { ok: true, order: view(row(db, r.id)) });
  }
  return null;
}
