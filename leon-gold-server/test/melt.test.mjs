// «خرید و فروش آبشده» (melt.mjs, owner 2026-11-16): colleagues only, prices = the seller's ± the owner's margin, an
// order waits 120 s, a moved price must be accepted again, one approval places the same trade once at the seller, and
// only a confirmed trade reaches «سند موقت». Every way an order can end is walked here, with the stand-in seller.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-melt-"));
process.env.MELT_SUPPLIER = "mock";
process.env.MELT_WAIT_S = "3";
process.env.MELT_PLACE_MS = "400";
const { server, setUser, db } = await import("../server.mjs");
const melt = await import("../melt.mjs"), sup = await import("../supplier.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token, method) => {
  const r = await fetch(base + p, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
await call("/api/push", { changes: [
  { c: "parties", id: "co1", d: { name: "طلای همکار", kind: "customer", biz: "melt" } },
  { c: "parties", id: "co2", d: { name: "گالری دوم", kind: "customer", biz: "gallery" } },
  { c: "parties", id: "cu1", d: { name: "مشتری", kind: "customer", biz: "person" } },
  { c: "settings", id: "melt", d: { on: true, msg: "قوانین", items: { m1: { on: true, m: 50000 }, m2: { on: true, m: 60000 }, g18: { on: true, m: 999999 }, c1: { on: true, m: 1000000 }, c2: { on: true, m: 500000 }, c4: { on: false, m: 1 }, s1: { on: true, m: 100000 } } } },
] }, owner);
for (const [pid, u] of [["co1", "hamkar1"], ["co2", "hamkar2"], ["cu1", "moshtari"]]) await call("/api/portal/login/set", { partyId: pid, username: u, password: "gold1234" }, owner);
const tok = async u => (await call("/api/portal/login", { u, p: "gold1234" })).token;
const c1 = await tok("hamkar1"), c2 = await tok("hamkar2"), cu = await tok("moshtari");
const temps = async () => (await (await fetch(base + "/api/pull?since=0", { headers: { Authorization: "Bearer " + owner } })).json()).changes.filter(x => x.c === "tempdocs" && x.d).map(x => x.d);
const fresh = () => { sup.mockReset(); melt.useSupplier(sup.make({ MELT_SUPPLIER: "mock" })); };

test("quantities: up to 3 decimals for mithqal and gram, whole numbers for coins; Persian digits read", () => {
  assert.equal(melt.qtyIn("2.5", 3), 2500);
  assert.equal(melt.qtyIn("۲٫۵", 3), 2500);
  assert.equal(melt.qtyIn("0.125", 3), 125);
  assert.equal(melt.qtyIn("1.2340", 3), 1234);
  assert.equal(melt.qtyIn("1.2345", 3), null);
  assert.equal(melt.qtyIn("2", 0), 2000);
  assert.equal(melt.qtyIn("2.5", 0), null);
  assert.equal(melt.qtyIn("0", 3), null);
  assert.equal(melt.qtyIn("-1", 3), null);
  assert.equal(melt.qtyIn("1e3", 3), null);
  assert.equal(melt.totalOf(106640000, 2500), 266600000);
});

test("colleagues only; a customer and a stranger see nothing", async () => {
  fresh();
  assert.equal((await call("/api/portal/melt")).status, 401);
  assert.equal((await call("/api/portal/melt", null, cu)).error, "colleagues_only");
  assert.equal((await call("/api/portal/melt", null, owner)).status, 401);   // an owner token is not a portal session
  const r = await call("/api/portal/melt", null, c1);
  assert.equal(r.on, true); assert.equal(r.msg, "قوانین"); assert.equal(r.wait, 3);
});

test("prices: the seller's ask + margin to buy, bid − margin to sell (toman ×10); the gram's margin is the mithqal's ÷ 4.3318; off items hidden", async () => {
  fresh();
  const r = await call("/api/portal/melt", null, c1), by = Object.fromEntries(r.items.map(x => [x.k, x]));
  assert.equal(by.m1.buy, 1061400000 + 500000); assert.equal(by.m1.sell, 1059900000 - 500000);
  assert.equal(by.m2.buy, 1065400000 + 600000);
  const gm = Math.round(50000 / 4.3318) * 10;           // 11542 toman → 115420 rial per gram; the typed 999999 is ignored
  assert.equal(by.g18.buy, 245025150 + gm); assert.equal(by.g18.sell, 244725060 - gm);
  assert.equal(by.c1.buy, 2499000000 + 10000000);
  assert.ok(!by.c4, "an item turned off is not offered");
  assert.equal(by.s1.buy, null, "no seller price (نداریم): not tradable"); assert.equal(by.s1.sell, null);
  // nothing about the seller itself
  assert.ok(!JSON.stringify(r).match(/bid|ask|sup|margin|key/i));
});

test("an order: the shown price must still be the price; one open order per colleague; an off item or a bad amount refused", async () => {
  fresh();
  const by = Object.fromEntries((await call("/api/portal/melt", null, c1)).items.map(x => [x.k, x]));
  assert.equal((await call("/api/portal/melt/order", { k: "c4", side: "buy", qty: "1", unit: 1 }, c1)).error, "bad_item");
  assert.equal((await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "1.2345", unit: by.m1.buy }, c1)).error, "bad_qty");
  assert.equal((await call("/api/portal/melt/order", { k: "s1", side: "buy", qty: "1", unit: 1 }, c1)).error, "no_price");
  const stale = await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "2.5", unit: by.m1.buy - 10000 }, c1);
  assert.equal(stale.error, "price_changed"); assert.equal(stale.unit, by.m1.buy); assert.equal(stale.total, Math.round(by.m1.buy * 2.5));
  const o = await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "2.5", unit: by.m1.buy }, c1);
  assert.equal(o.ok, true); assert.equal(o.order.status, "waiting"); assert.equal(o.order.total, Math.round(by.m1.buy * 2.5)); assert.ok(o.order.left >= 2);
  assert.equal((await call("/api/portal/melt/order", { k: "m1", side: "sell", qty: "1", unit: by.m1.sell }, c1)).error, "one_open");
  // another colleague cannot see or cancel it
  assert.equal((await call("/api/portal/melt/order/" + o.order.id, null, c2)).status, 404);
  assert.equal((await call("/api/portal/melt/order/" + o.order.id + "/cancel", {}, c2)).status, 404);
  assert.equal((await call("/api/portal/melt/order/" + o.order.id + "/cancel", {}, c1)).order.status, "cancelled");
  assert.equal(sup.mock.placed.length, 0);
});

test("the price moves while waiting: the colleague is shown the new price and total, the owner cannot approve until it is accepted", async () => {
  fresh();
  const by = Object.fromEntries((await call("/api/portal/melt", null, c1)).items.map(x => [x.k, x]));
  const o = (await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "2", unit: by.m1.buy }, c1)).order;
  sup.mock.prices.m1 = [1059900000, 1062400000]; await sleep(2100);   // +100,000 rial at the seller (the quote is kept 2 s)
  const g = (await call("/api/portal/melt/order/" + o.id, null, c1)).order;
  assert.deepEqual(g.changed, { unit: 1062400000 + 500000, total: (1062400000 + 500000) * 2 });
  const ap = await call("/api/melt/approve", { id: o.id }, owner);
  assert.equal(ap.error, "price_changed"); assert.equal(sup.mock.placed.length, 0);
  // accepting a price that is not the live one is refused
  assert.equal((await call("/api/portal/melt/order/" + o.id + "/accept", { unit: by.m1.buy }, c1)).error, "price_changed");
  const ac = await call("/api/portal/melt/order/" + o.id + "/accept", { unit: g.changed.unit }, c1);
  assert.equal(ac.ok, true); assert.equal(ac.order.unit, g.changed.unit); assert.equal(ac.order.total, g.changed.total); assert.ok(!ac.order.changed);
  // now one approval places it once; a second finds it no longer waiting
  const [a1, a2] = await Promise.all([call("/api/melt/approve", { id: o.id }, owner), call("/api/melt/approve", { id: o.id }, owner)]);
  assert.equal([a1, a2].filter(x => x.ok).length, 1, JSON.stringify([a1, a2]));
  assert.equal(sup.mock.placed.length, 1);
  assert.deepEqual({ ...sup.mock.placed[0] }, { k: "m1", side: "buy", qm: 2000, ref: o.id, price: 1062400000 });
  const T = (await temps()).find(x => x.order === o.id);
  assert.ok(T, "in «سند موقت»");
  assert.equal(T.partyId, "co1"); assert.equal(T.side, "buy"); assert.equal(T.qm, 2000); assert.equal(T.unit, g.changed.unit); assert.equal(T.total, g.changed.total);
  assert.equal(T.grp, "melt"); assert.equal(T.g, 4.3318); assert.equal(T.reg, ""); assert.equal(T.supRef, "mock-" + o.id);
  assert.equal((await call("/api/portal/melt/order/" + o.id, null, c1)).order.status, "done");
  assert.equal((await call("/api/portal/melt/order/" + o.id + "/cancel", {}, c1)).error, "not_waiting");
});

test("a sell of coins mirrors as a sell at the seller's bid; reject; expiry after the wait", async () => {
  fresh();
  const by = Object.fromEntries((await call("/api/portal/melt", null, c2)).items.map(x => [x.k, x]));
  const o = (await call("/api/portal/melt/order", { k: "c1", side: "sell", qty: "3", unit: by.c1.sell }, c2)).order;
  assert.equal(o.total, (2493000000 - 10000000) * 3);
  assert.equal((await call("/api/melt/approve", { id: o.id }, owner)).ok, true);
  assert.deepEqual({ ...sup.mock.placed[0] }, { k: "c1", side: "sell", qm: 3000, ref: o.id, price: 2493000000 });
  const T = (await temps()).find(x => x.order === o.id);
  assert.equal(T.fx, "cn"); assert.equal(T.qty, 3); assert.equal(T.grp, "coin");
  // reject
  const o2 = (await call("/api/portal/melt/order", { k: "c2", side: "buy", qty: "1", unit: by.c2.buy }, c2)).order;
  assert.equal((await call("/api/melt/reject", { id: o2.id }, owner)).ok, true);
  assert.equal((await call("/api/portal/melt/order/" + o2.id, null, c2)).order.status, "rejected");
  assert.equal((await call("/api/melt/approve", { id: o2.id }, owner)).error, "not_waiting");
  // expiry
  const o3 = (await call("/api/portal/melt/order", { k: "c2", side: "buy", qty: "1", unit: by.c2.buy }, c2)).order;
  await sleep(3200);
  assert.equal((await call("/api/portal/melt/order/" + o3.id, null, c2)).order.status, "expired");
  assert.equal((await call("/api/melt/approve", { id: o3.id }, owner)).error, "not_waiting");
  assert.equal(sup.mock.placed.length, 1);
});

test("the seller refuses: failed, nothing in «سند موقت»; the seller never answers: unknown until the owner settles it", async () => {
  fresh();
  let by = Object.fromEntries((await call("/api/portal/melt", null, c1)).items.map(x => [x.k, x]));
  sup.mock.fail = "rejected";
  const o = (await call("/api/portal/melt/order", { k: "g18", side: "buy", qty: "10.5", unit: by.g18.buy }, c1)).order;
  const f = await call("/api/melt/approve", { id: o.id }, owner);
  assert.equal(f.error, "failed"); assert.equal(f.reason, "rejected");
  assert.ok(!(await temps()).some(x => x.order === o.id));
  assert.equal((await call("/api/portal/melt/order/" + o.id, null, c1)).order.status, "failed");
  // no answer
  sup.mock.fail = ""; sup.mock.hang = true;
  const o2 = (await call("/api/portal/melt/order", { k: "g18", side: "sell", qty: "1", unit: by.g18.sell }, c1)).order;
  const u = await call("/api/melt/approve", { id: o2.id }, owner);
  assert.equal(u.error, "unknown"); assert.equal(u.order.status, "unknown");
  assert.equal((await call("/api/melt/approve", { id: o2.id }, owner)).error, "not_waiting");
  const L = (await call("/api/melt/orders", null, owner)).orders;
  assert.equal(L.find(x => x.id === o2.id).status, "unknown");
  assert.equal((await call("/api/melt/resolve", { id: o2.id, placed: true }, owner)).order.status, "done");
  assert.ok((await temps()).some(x => x.order === o2.id));
  assert.equal((await call("/api/melt/resolve", { id: o2.id, placed: false }, owner)).error, "not_unknown");
});

test("the seller is down: no prices, nothing can be ordered; the owner's pages need the owner", async () => {
  fresh(); sup.mock.down = true; await sleep(2100);
  const r = await call("/api/portal/melt", null, c1);
  assert.equal(r.ok, false); assert.ok(r.items.every(x => x.buy === null && x.sell === null));
  assert.equal((await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "1", unit: 1 }, c1)).error, "no_price");
  for (const p of ["/api/melt/orders", "/api/melt/prices"]) { assert.equal((await call(p)).status, 401); assert.equal((await call(p, null, c1)).status, 401); }
  for (const p of ["/api/melt/approve", "/api/melt/reject", "/api/melt/resolve"]) assert.equal((await call(p, { id: "x" }, c1)).status, 401);
  sup.mock.down = false;
});

test("no supplier configured: nothing tradable, and the key never appears anywhere", async () => {
  melt.useSupplier(sup.make({ MELT_SUPPLIER: "live", MELT_API_URL: "https://seller.example", MELT_API_KEY: "SECRET-KEY-123" }));
  await sleep(2100);
  const r = await call("/api/portal/melt", null, c1), p = await call("/api/melt/prices", null, owner);
  assert.equal(r.ok, false); assert.equal(p.ok, false);
  assert.ok(!JSON.stringify([r, p]).includes("SECRET"));
  const rows = db.prepare("SELECT * FROM melt_orders").all().concat(db.prepare("SELECT * FROM melt_log").all(), db.prepare("SELECT data FROM docs").all());
  assert.ok(!JSON.stringify(rows).includes("SECRET"));
  fresh();
});

test.after(() => server.close());
