// «ثبت نام» in «حساب من» (owner, 2026-11-09): the account opens at once (no approval): a party is made with the kind of
// business chosen; national code and mobile are required, and someone claiming to be in the trade gives what only the
// trade has. Also: wages by kind of business, and the public site's showcase.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-signup-"));
const { server, setUser, exportCopy } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token, ip) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
const pull = async () => (await call("/api/pull?since=0", null, owner)).changes;
const sync = changes => call("/api/push", { changes }, owner);
const form = { fullName: "سارا رضایی", mobile: "۰۹۱۲۱۲۳۴۵۶۷", nationalId: "۰۰۸۴۵۷۵۹۴۸", biz: "retail", birth: "۱۳۷۰/۰۵/۱۲", username: "Sara.R", password: "Gold۱۴05" };

test("the kinds of business are public, and the owner's own list replaces the default", async () => {
  const d = await call("/api/public/biz");
  assert.ok(d.types.some(t => t.k === "gallery" && t.group === "colleague"));
  assert.ok(d.types.some(t => t.k === "retail" && t.group === "retail"));
  assert.ok(!d.types.some(t => t.k === "home"), "«خانگی» is hidden (owner, 2026-11-09)");
});

test("a sign-up is checked; then the account is made at once and signed in", async () => {
  assert.equal((await call("/api/portal/signup", { ...form, nationalId: "0084575949" }, null, "10.1.0.1")).error, "bad_nid");
  assert.equal((await call("/api/portal/signup", { ...form, mobile: "123" }, null, "10.1.0.1")).error, "bad_mobile");
  assert.equal((await call("/api/portal/signup", { ...form, biz: "nope" }, null, "10.1.0.1")).error, "bad_biz");
  assert.equal((await call("/api/portal/signup", { ...form, username: "س" }, null, "10.1.0.1")).error, "bad_username");
  const r = await call("/api/portal/signup", form, null, "10.1.0.2");
  assert.equal(r.ok, true); assert.equal(r.username, "sara.r"); assert.ok(r.token);
  const me = await call("/api/portal/me", null, r.token);
  assert.equal(me.accounts[0].name, "سارا رضایی"); assert.equal(me.accounts[0].group, "retail"); assert.equal(me.accounts[0].biz, "retail");
  assert.equal(me.info.nationalId, "0084575948");
  const ch = await pull();
  const party = ch.find(c => c.c === "parties"), su = ch.find(c => c.c === "signups");
  assert.equal(party.d.name, "سارا رضایی"); assert.equal(party.d.biz, "retail"); assert.equal(party.d.phone, "09121234567");
  assert.equal(su.d.status, "auto"); assert.equal(su.d.partyId, party.id);
  assert.ok(!JSON.stringify(su.d).match(/hash|salt|Gold/i));
  assert.equal((await call("/api/portal/login", { u: "SARA.R", p: "Gold1405" })).status, 200);
  // the same national code or username again: refused
  assert.equal((await call("/api/portal/signup", { ...form, username: "other1" }, null, "10.1.0.3")).error, "nid_taken");
  assert.equal((await call("/api/portal/signup", { ...form, nationalId: "0013542419" }, null, "10.1.0.3")).error, "username_taken");
  // not in the off-site copy
  const f = exportCopy(); const { DatabaseSync } = await import("node:sqlite"); const c = new DatabaseSync(f);
  assert.equal(c.prepare("SELECT count(*) AS n FROM portal_signups").get().n, 0); c.close(); fs.rmSync(f);
});

test("someone who says they are in the trade must give the trade's own details", async () => {
  const g = { ...form, fullName: "گالری علی", biz: "gallery", nationalId: "0013542419", mobile: "09351112233", username: "ali.k" };
  assert.equal((await call("/api/portal/signup", g, null, "10.1.0.4")).error, "bad_trade");
  assert.equal((await call("/api/portal/signup", { ...g, shop: "گالری علی", licence: "12ab", union: "۴۵۶۷۸", shopAddr: "بازار بزرگ، پاساژ طلا، پلاک ۱۲" }, null, "10.1.0.4")).error, "bad_trade");
  const r = await call("/api/portal/signup", { ...g, shop: "گالری علی", licence: "۱۲۳۴۵۶۷۸", union: "۴۵۶۷۸", shopAddr: "بازار بزرگ، پاساژ طلا، پلاک ۱۲" }, null, "10.1.0.4");
  assert.equal(r.ok, true);
  const su = (await pull()).filter(c => c.c === "signups").find(c => c.d.username === "ali.k");
  assert.equal(su.d.group, "colleague"); assert.equal(su.d.licence, "12345678"); assert.equal(su.d.union, "45678");
});

test("too many sign-ups from one address are refused", async () => {
  let last;
  for (let i = 0; i < 7; i++) last = await call("/api/portal/signup", { ...form, username: "flood" + i }, null, "10.9.9.9");
  assert.equal(last.error, "too_many");
});

test("a piece's wage follows the party's kind of business; the public site gets only pieces marked for it, at the site's wage", async () => {
  await sync([
    { c: "vitrin", id: "v1", d: { name: "انگشتر", tags: ["lux", "laser", "gone"], weight: 3, carat: 750, ajrat: 12, profit: 7, show: true, prices: [{ ajrat: 20, profit: 9, biz: ["retail"] }], site: true, siteAjrat: 25, siteProfit: 10, media: [{ id: "m1", type: "image" }], ts: "2026-11-09T10:00:00Z" } },
    { c: "vitrin", id: "v2", d: { name: "گوشواره", weight: 2, carat: 750, ajrat: 15, show: true, ts: "2026-11-09T09:00:00Z" } },
  ]);
  const sara = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token, ali = (await call("/api/portal/login", { u: "ali.k", p: "Gold1405" })).token;
  const sv = (await call("/api/portal/vitrin", null, sara)).items.find(x => x.id === "v1"), av = (await call("/api/portal/vitrin", null, ali)).items.find(x => x.id === "v1");
  assert.deepEqual([sv.ajrat, sv.profit], [20, 9]);  // «خانگی»: the second wage
  assert.deepEqual([av.ajrat, av.profit], [12, 7]);  // «گالری»: the base wage
  const pub = await call("/api/public/vitrin");
  assert.deepEqual(pub.items.map(x => x.id), ["v1"]);
  assert.deepEqual([pub.items[0].ajrat, pub.items[0].profit], [25, 10]);
  assert.deepEqual(pub.items[0].tags, ["لوکس", "لیزری"]); // a tag no longer in the list is left out
  assert.deepEqual(sv.tags, ["لوکس", "لیزری"]);
  assert.equal((await fetch(base + "/api/public/media/nope")).status, 404);
});

test("an order waits for Leon's confirmation; its price follows the rate; past its time it says so", async () => {
  const sara = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token;
  const o = await call("/api/portal/vitrin/order", { id: "v1", note: "سایز ۵۲", gp: 88000000, total: 115000000 }, sara);
  assert.equal(o.ok, true); assert.equal(o.wait, 120); assert.ok(o.exp > Date.now() + 100000);
  let st = await call("/api/portal/vitrin/order/" + o.id, null, sara);
  assert.equal(st.status, "waiting"); assert.ok(st.left > 100); assert.equal(st.price.total, 115000000);
  assert.equal((await call("/api/portal/vitrin/order/" + o.id + "/price", { gp: 89000000, total: 116300000 }, sara)).ok, true);
  const lead = (await pull()).filter(c => c.c === "crm_leads" && c.id === o.id).pop().d;
  assert.equal(lead.status, "waiting"); assert.equal(lead.price.total, 116300000); assert.equal(lead.price.changed, true);
  // someone else's order is not theirs to see
  const ali = (await call("/api/portal/login", { u: "ali.k", p: "Gold1405" })).token;
  assert.equal((await call("/api/portal/vitrin/order/" + o.id, null, ali)).status, 404);
  // Leon confirms it in the ledger
  await sync([{ c: "crm_leads", id: o.id, d: { ...lead, status: "confirmed" } }]);
  assert.equal((await call("/api/portal/vitrin/order/" + o.id, null, sara)).status, "confirmed");
  assert.equal((await call("/api/portal/vitrin/order/" + o.id + "/price", { gp: 1, total: 1 }, sara)).error, "not_waiting");
  // one left waiting past its time
  const o2 = await call("/api/portal/vitrin/order", { id: "v1", gp: 88000000, total: 115000000 }, sara);
  const l2 = (await pull()).filter(c => c.c === "crm_leads" && c.id === o2.id).pop().d;
  await sync([{ c: "crm_leads", id: o2.id, d: { ...l2, exp: new Date(Date.now() - 1000).toISOString() } }]);
  assert.equal((await call("/api/portal/vitrin/order/" + o2.id, null, sara)).status, "expired");
  assert.equal((await pull()).filter(c => c.c === "crm_leads" && c.id === o2.id).pop().d.status, "expired");
});

test("a party sets, sees and removes its own profile photo", async () => {
  const t = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal((await call("/api/portal/avatar", { image: "data:text/html;base64,PGI+" }, t)).error, "bad_type");
  assert.equal((await call("/api/portal/avatar", { image: "data:image/jpeg;base64," + "A".repeat(500000) }, t)).error, "too_large");
  assert.equal((await call("/api/portal/avatar", { image: png })).status, 401);
  assert.equal((await call("/api/portal/avatar", { image: png }, t)).ok, true);
  assert.equal((await call("/api/portal/me", null, t)).photo, png);
  assert.equal((await call("/api/portal/avatar/remove", {}, t)).ok, true);
  assert.equal((await call("/api/portal/me", null, t)).photo, undefined);
});

test("an odd piece (a date as a number, a number for a name) never stops the showcase", async () => {
  await sync([
    { c: "vitrin", id: "vt1", d: { name: "پلاک", cat: "پلاک و آویز", weight: 2, carat: 750, ajrat: 9, show: true, site: true, ts: Date.now() } },
    { c: "vitrin", id: "vt2", d: { name: 123, weight: "x", show: true, site: true, tags: "lux", media: "no", settle: null, ts: { a: 1 } } },
  ]);
  const pub = await call("/api/public/vitrin");
  assert.ok(Array.isArray(pub.items), JSON.stringify(pub));
  assert.ok(pub.items.some(x => x.id === "vt1") && pub.items.some(x => x.id === "vt2" && x.name === "123"));
  const v2 = pub.items.find(x => x.id === "vt2");
  assert.deepEqual([v2.tags, v2.media, v2.settle, v2.weight], [["لوکس"], [], [], 0]);
  const ali = (await call("/api/portal/login", { u: "ali.k", p: "Gold1405" })).token;
  assert.ok(Array.isArray((await call("/api/portal/vitrin", null, ali)).items));
});

test("an invite code: a sign-up through it is marked as brought by its owner; a wrong code is refused", async () => {
  const sara = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token, me = (await call("/api/portal/me", null, sara)).accounts[0].id;
  const inv = await call("/api/portal/invite", null, sara);
  assert.match(inv.code, /^[A-Z2-9]{6}$/);
  assert.equal(inv.joined, 0);
  assert.equal((await call("/api/portal/invite", null, sara)).code, inv.code, "the same code every time");
  assert.equal((await call("/api/portal/invite")).status, 401);
  const f2 = { fullName: "مینا احمدی", mobile: "09127654321", nationalId: "0012345601", biz: "retail", username: "mina.a", password: "Gold1405" };
  assert.equal((await call("/api/portal/signup", { ...f2, ref: "ZZZZZZ" }, null, "10.9.0.1")).error, "bad_ref");
  const r = await call("/api/portal/signup", { ...f2, ref: " " + inv.code.toLowerCase() + " " }, null, "10.9.0.2");
  assert.equal(r.ok, true, JSON.stringify(r));
  const party = (await pull()).find(c => c.c === "parties" && c.d && c.d.name === "مینا احمدی");
  assert.equal(party.d.refBy, me);
  assert.ok(party.d.refAt);
  assert.equal((await pull()).find(c => c.c === "signups" && c.d && c.d.partyId === party.id).d.refName, "سارا رضایی");
  assert.equal((await call("/api/portal/invite", null, sara)).joined, 1);
});

test("the market analysis is only for a VIP party the owner chose", async () => {
  const t = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token, me = await call("/api/portal/me", null, t), id = me.accounts[0].id;
  const doc = (await pull()).filter(c => c.c === "parties" && c.id === id).pop().d;
  assert.equal(me.accounts[0].market, undefined);
  await sync([{ c: "parties", id, d: { ...doc, market: true } }]);
  assert.equal((await call("/api/portal/me", null, t)).accounts[0].market, undefined, "not VIP: no analysis");
  await sync([{ c: "parties", id, d: { ...doc, market: true, vip: true } }]);
  assert.equal((await call("/api/portal/me", null, t)).accounts[0].market, true);
  await sync([{ c: "parties", id, d: doc }]);
});

test("a supplier the owner allows adds and edits only its own pieces; they wait for the owner", async () => {
  const ali = (await call("/api/portal/login", { u: "ali.k", p: "Gold1405" })).token, me = (await call("/api/portal/me", null, ali)).accounts[0].id;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  assert.equal((await call("/api/portal/studio/media", { data: png }, ali)).error, "no_upload", "not allowed yet");
  const doc = (await pull()).filter(c => c.c === "parties" && c.id === me).pop().d;
  await sync([{ c: "parties", id: me, d: { ...doc, upload: true } }]);
  assert.equal((await call("/api/portal/me", null, ali)).accounts[0].upload, true);
  assert.equal((await call("/api/portal/studio/media", { data: "data:text/html;base64,PGI+" }, ali)).error, "bad_type");
  const m = await call("/api/portal/studio/media", { data: png }, ali);
  assert.ok(m.ok && m.id.startsWith("vp"), JSON.stringify(m));
  assert.equal((await call("/api/portal/studio/save", { name: "النگو", weight: "۱۲٫۵", media: [] }, ali)).error, "no_photo");
  const sv = await call("/api/portal/studio/save", { name: "النگو طرح برگ", cat: "النگو", weight: "۱۲٫۵", carat: 750, supAjrat: "۶", qty: 2, desc: "دست‌ساز", media: [m] }, ali);
  assert.ok(sv.ok, JSON.stringify(sv));
  const v = (await pull()).filter(c => c.c === "vitrin" && c.id === sv.id).pop().d;
  assert.equal(v.supId, me); assert.equal(v.pending, true); assert.equal(v.show, false); assert.equal(v.supAjrat, 6); assert.equal(v.weight, 12.5);
  const mine = (await call("/api/portal/vitrin", null, ali)).mine.find(x => x.id === sv.id);
  assert.equal(mine.status, "pending");
  assert.ok(!("ajrat" in mine));
  // a karat typed with Persian digits keeps its value (not silently 750)
  const sv2 = await call("/api/portal/studio/save", { id: sv.id, name: "النگو طرح برگ", weight: "۱۲٫۵", carat: "۹۱۶", media: [m] }, ali);
  assert.ok(sv2.ok, JSON.stringify(sv2));
  assert.equal((await pull()).filter(c => c.c === "vitrin" && c.id === sv.id).pop().d.carat, 916);
  // someone else's piece cannot be edited
  await sync([{ c: "vitrin", id: "other", d: { name: "مال کس دیگر", weight: 2, show: true, supId: "someone", media: [] } }]);
  assert.equal((await call("/api/portal/studio/save", { id: "other", name: "دزدی", weight: 1, media: [m] }, ali)).error, "not_found");
  assert.equal((await call("/api/portal/studio/remove", { id: "other" }, ali)).error, "not_found");
  // a customer without the right
  const sara = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token;
  assert.equal((await call("/api/portal/studio/save", { name: "x", weight: 1, media: [m] }, sara)).error, "no_upload");
  // a piece already on show that the supplier edits waits for the owner again: buyers do not see the unreviewed change
  await sync([{ c: "vitrin", id: sv.id, d: { ...v, pending: false, show: true } }]);
  assert.ok((await call("/api/portal/vitrin", null, sara)).items.some(x => x.id === sv.id), "live after review");
  assert.ok((await call("/api/portal/studio/save", { id: sv.id, name: "النگو طرح برگ", weight: 99, media: [m] }, ali)).ok);
  assert.ok(!(await call("/api/portal/vitrin", null, sara)).items.some(x => x.id === sv.id), "edit hidden until reviewed");
  await sync([{ c: "vitrin", id: sv.id, d: { ...v, show: false, pending: true } }]);
  // removed before ever shown: gone
  assert.equal((await call("/api/portal/studio/remove", { id: sv.id }, ali)).ok, true);
  assert.equal((await pull()).filter(c => c.c === "vitrin" && c.id === sv.id).pop().d, null);
});

test("a supplier sees its own pieces apart («محصولات شما در لئون»), with no wage, profit, tax or price", async () => {
  const ali = (await call("/api/portal/login", { u: "ali.k", p: "Gold1405" })).token, me = (await call("/api/portal/me", null, ali)).accounts[0].id;
  await sync([{ c: "vitrin", id: "vs", d: { name: "النگو کارگاه", weight: 9, carat: 750, ajrat: 14, profit: 7, show: true, supId: me, to: ["someone-else"], media: [{ id: "ms", type: "image" }], ts: "2026-11-09T11:00:00Z" } }]);
  const v = await call("/api/portal/vitrin", null, ali);
  assert.deepEqual(v.mine.map(x => x.id), ["vs"]);
  assert.equal(v.mine[0].mine, true);
  assert.ok(!("ajrat" in v.mine[0]) && !("profit" in v.mine[0]));
  assert.ok(!v.items.some(x => x.id === "vs"));
  const sara = (await call("/api/portal/login", { u: "sara.r", p: "Gold1405" })).token;
  assert.deepEqual((await call("/api/portal/vitrin", null, sara)).mine, []);
});

test("«خانگی» becomes «مشتری تک‌فروشی» everywhere, once", async () => {
  const { migrateHome } = await import("../server.mjs");
  await sync([
    { c: "parties", id: "h1", d: { name: "مشتری قدیمی", kind: "customer", biz: "home" } },
    { c: "vitrin", id: "v3", d: { name: "دستبند", weight: 4, ajrat: 10, show: true, prices: [{ ajrat: 22, biz: ["home", "gallery"] }] } },
    { c: "settings", id: "biz", d: { types: [{ k: "home", name: "خانگی", group: "retail" }, { k: "retail", name: "مشتری تک‌فروشی", group: "retail" }, { k: "gallery", name: "گالری", group: "colleague" }] } },
  ]);
  assert.equal(migrateHome(true), 3);
  const ch = await pull(), last = (c, id) => ch.filter(x => x.c === c && x.id === id).pop().d;
  assert.equal(last("parties", "h1").biz, "retail");
  assert.deepEqual(last("vitrin", "v3").prices[0].biz, ["retail", "gallery"]);
  assert.equal(last("settings", "biz").types[0].off, true);
  assert.ok(!(await call("/api/public/biz")).types.some(t => t.k === "home"));
  assert.equal(migrateHome(), 0); // once
  server.close();
});
