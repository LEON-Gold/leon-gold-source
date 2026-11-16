// The customers' and suppliers' panel: username/password and one-time link sign-in, and that each party sees only its own share.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-portal-"));
const { server, setUser } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token, method) => {
  const r = await fetch(base + p, { method: method || (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
await call("/api/push", { changes: [
  { c: "parties", id: "c1", d: { name: "خانم احمدی", kind: "customer", phone: "۰۹۱۲ ۳۴۵ ۶۷۸۹", openR: 1000000, ts: "2026-01-01T00:00:00Z" } },
  { c: "parties", id: "s1", d: { name: "کارگاه نیک", kind: "supplier", phone: "09350000000", openG: -2.5, ts: "2026-01-01T00:00:00Z" } },
  { c: "parties", id: "x1", d: { name: "دیگری", kind: "customer", phone: "09120000000" } },
  { c: "invoices", id: "i1", d: { kind: "retail", no: "12", date: "۱۴۰۵/۰۸/۰۱", partyId: "c1", deltaR: 25000000, ts: "2026-02-01T00:00:00Z",
    items: [{ desc: "انگشتر", qty: 1, weight: 3.2, carat: 18, ajrat: 18, profit: 7, ajratProfit: 999, amount: 25000000 }] } },
  { c: "invoices", id: "i2", d: { kind: "whole", doc: "rc", no: "7", partyId: "s1", deltaG: -10.25, ts: "2026-02-02T00:00:00Z",
    items: [{ desc: "النگو", qty: 2, weight: 10, carat: 750, ajrat: 2.5, costAj: 2, totalG: 10.25, pid: "pr1" }] } },
  { c: "settlements", id: "st1", d: { partyId: "c1", dir: "in", unit: "r", amount: 6000000, note: "یادداشت داخلی", ts: "2026-02-03T00:00:00Z" } },
  { c: "orders", id: "ord-abcd", d: { partyId: "c1", partyName: "خانم احمدی", status: "src", due: "۱۴۰۵/۰۹/۰۱", ts: "2026-02-04T00:00:00Z",
    items: [{ desc: "گردنبند اسم", qty: 1, weight: 4, carat: 18, supId: "s1", supName: "کارگاه نیک", pid: "pr2" }, { desc: "پلاک", qty: 1, supId: "" }] } },
  { c: "products", id: "pr2", d: { name: "گردنبند اسم", photo: "ph-necklace", buyAjrat: 5 } },
] }, owner);
await fetch(base + "/api/blob/ph-necklace", { method: "PUT", headers: { Authorization: "Bearer " + owner, "Content-Type": "image/png" }, body: Buffer.from([137, 80, 78, 71]) });

// a sign-in from a given address (the server reads X-Forwarded-For), so the per-address limit can be tested apart
const login = async (u, p, ip = "10.0.0.1") => { const r = await fetch(base + "/api/portal/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify({ u, p }) }); return { status: r.status, ...(await r.json()) }; };
const setLogin = (b, t = owner) => call("/api/portal/login/set", b, t);

test("username and password: only the owner sets them; Persian digits and capitals count the same; never sent back", async () => {
  assert.equal((await setLogin({ partyId: "c1", username: "ahmadi", password: "gold1234" }, null)).status, 401);
  assert.equal((await setLogin({ partyId: "nope", username: "ahmadi", password: "gold1234" })).error, "no_party");
  assert.equal((await setLogin({ partyId: "c1", username: "a b", password: "gold1234" })).error, "bad_username");
  assert.equal((await setLogin({ partyId: "c1", username: "ahmadi" })).error, "bad_password"); // the first time needs a password
  assert.equal((await setLogin({ partyId: "c1", username: "ahmadi", password: "12345" })).error, "bad_password");
  assert.equal((await setLogin({ partyId: "c1", username: "Ahmadi.۱", password: "طلا۱۲۳۴" })).username, "ahmadi.1");
  assert.equal((await setLogin({ partyId: "x1", username: "AHMADI.1", password: "other123" })).error, "username_taken");
  const list = await call("/api/portal/logins", null, owner);
  assert.deepEqual(list.logins, [{ partyId: "c1", username: "ahmadi.1" }]);
  assert.ok(!/salt|hash/.test(JSON.stringify(list)));
  assert.equal((await call("/api/portal/logins")).status, 401);
  assert.equal((await login("ahmadi.1", "طلا1234wrong")).error, "bad_login");
  const t = (await login("AHMADI.1", "طلا1234")).token;
  assert.ok(t);
  assert.equal((await call("/api/portal/me", null, t)).accounts[0].name, "خانم احمدی");
  assert.equal((await call("/api/pull?since=0", null, t)).status, 401); // a portal token never opens the ledger's sync API
});

test("renaming keeps the party signed in; a new password or removing the login signs it out everywhere", async () => {
  const t = (await login("ahmadi.1", "طلا1234")).token;
  await setLogin({ partyId: "c1", username: "ahmadi2", password: "" });
  assert.equal((await call("/api/portal/me", null, t)).status, 200);
  assert.equal((await login("ahmadi2", "طلا1234")).status, 200);
  await setLogin({ partyId: "c1", username: "ahmadi2", password: "newpass99" });
  assert.equal((await call("/api/portal/me", null, t)).status, 401);
  assert.equal((await login("ahmadi2", "طلا1234")).error, "bad_login");
  const t2 = (await login("ahmadi2", "newpass99")).token;
  await call("/api/portal/login/remove", { partyId: "c1" }, owner);
  assert.equal((await call("/api/portal/me", null, t2)).status, 401);
  assert.equal((await login("ahmadi2", "newpass99")).error, "bad_login");
});

test("a party changes its own starting password: the old one first, its other devices sign out, this one stays", async () => {
  await setLogin({ partyId: "x1", username: "09120000000", password: "۴۸۲۹۱۷" });
  const a = (await login("09120000000", "482917", "10.0.0.7")).token, b = (await login("09120000000", "482917", "10.0.0.7")).token;
  const me = await call("/api/portal/me", null, a);
  assert.equal(me.username, "09120000000");
  assert.equal((await call("/api/portal/password", { old: "000000", new: "mynewpass" }, a)).error, "bad_old");
  assert.equal((await call("/api/portal/password", { old: "482917", new: "123" }, a)).error, "bad_password");
  assert.equal((await call("/api/portal/password", { old: "482917", new: "mynewpass" })).status, 401);
  assert.equal((await call("/api/portal/password", { old: "482917", new: "mynewpass" }, a)).ok, true);
  assert.equal((await call("/api/portal/me", null, a)).status, 200);
  assert.equal((await call("/api/portal/me", null, b)).status, 401);
  assert.equal((await login("09120000000", "482917", "10.0.0.7")).error, "bad_login");
  assert.equal((await login("09120000000", "mynewpass", "10.0.0.7")).status, 200);
  // and its username, with the current password; a taken or bad one is refused, the old one stops working
  const c = (await login("09120000000", "mynewpass", "10.0.0.8")).token;
  await setLogin({ partyId: "c1", username: "ahmadi", password: "ahmadi1" });
  assert.equal((await call("/api/portal/password", { old: "wrong", username: "newname" }, c)).error, "bad_old");
  assert.equal((await call("/api/portal/password", { old: "mynewpass", username: "AHMADI" }, c)).error, "username_taken");
  assert.equal((await call("/api/portal/password", { old: "mynewpass", username: "a b" }, c)).error, "bad_username");
  assert.equal((await call("/api/portal/password", { old: "mynewpass", username: "09120000000" }, c)).error, "nothing");
  assert.equal((await call("/api/portal/password", { old: "mynewpass", username: "Davood.۷" }, c)).username, "davood.7");
  assert.equal((await call("/api/portal/me", null, c)).username, "davood.7"); // still signed in
  assert.equal((await login("09120000000", "mynewpass", "10.0.0.9")).error, "bad_login");
  assert.equal((await login("davood.7", "mynewpass", "10.0.0.9")).status, 200);
  assert.equal((await call("/api/portal/logins", null, owner)).logins.find(x => x.partyId === "x1").username, "davood.7"); // the ledger sees it
  await call("/api/portal/login/remove", { partyId: "c1" }, owner);
  // a party that came in by link and has no username yet cannot set one itself
  await call("/api/portal/login/remove", { partyId: "x1" }, owner);
  const k = (await call("/api/portal/invite", { partyId: "x1" }, owner)).k, t = (await call("/api/portal/redeem", { k })).token;
  assert.equal((await call("/api/portal/me", null, t)).username, undefined);
  assert.equal((await call("/api/portal/password", { old: "x", new: "mynewpass" }, t)).error, "no_login");
});

test("wrong passwords are limited per username (even from new addresses) and per address", async () => {
  await setLogin({ partyId: "x1", username: "digari", password: "right123" });
  for (let i = 0; i < 10; i++) assert.equal((await login("digari", "wrong", "10.1.0." + i)).error, "bad_login");
  assert.equal((await login("digari", "right123", "10.1.1.1")).error, "too_many"); // blocked even with the right password
  for (let i = 0; i < 10; i++) await login("nobody" + i, "wrong", "10.2.0.1");
  assert.equal((await login("someone-else", "x", "10.2.0.1")).error, "too_many");
  assert.equal((await login("nobody0", "wrong", "10.2.0.2")).error, "bad_login"); // another address is still let through
});

test("a customer sees their balance, statement and orders; never internal notes, margins or the workshop", async () => {
  await new Promise(r => setTimeout(r, 0));
  const p = (await call("/api/portal/invite", { partyId: "c1" }, owner));
  assert.match(p.link, /hesab\/#k=/);
  const t = (await call("/api/portal/redeem", { k: p.k })).token;
  assert.equal((await call("/api/portal/redeem", { k: p.k })).error, "expired"); // one use
  const me = await call("/api/portal/me", null, t);
  assert.equal(me.accounts.length, 1);
  const a = me.accounts[0];
  assert.equal(a.name, "خانم احمدی");
  assert.deepEqual(a.bal, { g: 0, r: 20000000 });
  assert.equal(a.ent.length, 3);
  assert.equal(a.ent[0].run, 20000000); // newest first, running balance matches
  const raw = JSON.stringify(me);
  for (const secret of ["یادداشت داخلی", "کارگاه نیک", "s1", "ajratProfit", "costAj", "profit", "دیگری"]) assert.ok(!raw.includes(secret), secret);
  assert.equal(a.orders[0].statusLabel, "در حال تهیه");
  assert.equal(a.orders[0].ref, "ABCD");
  assert.equal(a.work.length, 0);
});

test("a supplier sees their gold balance and their share of open orders, without the customer", async () => {
  const k = (await call("/api/portal/invite", { partyId: "s1" }, owner)).k;
  const me = await call("/api/portal/me", null, (await call("/api/portal/redeem", { k })).token);
  const a = me.accounts[0];
  assert.deepEqual(a.bal, { g: -12.75, r: 0 });
  assert.equal(a.work.length, 1);
  assert.equal(a.work[0].desc, "گردنبند اسم");
  assert.equal(a.orders.length, 0);
  const raw = JSON.stringify(me);
  for (const secret of ["خانم احمدی", "c1", "پلاک", "costAj", "pr1"]) assert.ok(!raw.includes(secret), secret);
});

test("a line item's photo is the product's own; served to the party it belongs to, denied to others, product id never leaks", async () => {
  const ct = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "c1" }, owner)).k })).token;
  const st = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "s1" }, owner)).k })).token;
  const xt = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "x1" }, owner)).k })).token;
  const meC = await call("/api/portal/me", null, ct), meS = await call("/api/portal/me", null, st);
  assert.equal(meC.accounts[0].orders[0].items[0].photo, "ph-necklace");
  assert.equal(meS.accounts[0].work[0].photo, "ph-necklace");
  assert.ok(!JSON.stringify(meC).includes("pr2") && !JSON.stringify(meS).includes("pr2"));
  assert.equal((await fetch(base + "/api/portal/photo/ph-necklace", { headers: { Authorization: "Bearer " + ct } })).status, 200);
  assert.equal((await fetch(base + "/api/portal/photo/ph-necklace", { headers: { Authorization: "Bearer " + st } })).status, 200);
  assert.equal((await fetch(base + "/api/portal/photo/ph-necklace", { headers: { Authorization: "Bearer " + xt } })).status, 404); // another customer: denied
  assert.equal((await fetch(base + "/api/portal/photo/ph-necklace")).status, 401); // no token at all
  // a bought piece carries its product photo too («حساب من»'s jewellery box), and only its owner gets it
  await call("/api/push", { changes: [{ c: "invoices", id: "i9", d: { kind: "retail", no: "30", partyId: "x1", deltaR: 0, ts: "2026-02-09T00:00:00Z", items: [{ desc: "گردنبند اسم", qty: 1, weight: 4, carat: 18, amount: 0, pid: "pr2" }] } }] }, owner);
  const meX = await call("/api/portal/me", null, xt), line = meX.accounts[0].ent.find(e => e.lines).lines[0];
  assert.equal(line.photo, "ph-necklace");
  assert.ok(!JSON.stringify(meX).includes("pr2"));
  assert.equal((await fetch(base + "/api/portal/photo/ph-necklace", { headers: { Authorization: "Bearer " + xt } })).status, 200);
  await call("/api/push", { changes: [{ c: "invoices", id: "i9", d: null }] }, owner);
});

test("a customer's card-to-card receipt: pending, cross-party denied, type/size/rate limits, owner marks it done", async () => {
  const ct = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "c1" }, owner)).k })).token;
  const xt = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "x1" }, owner)).k })).token;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  assert.equal((await call("/api/portal/receipt", { image: "not-an-image" }, ct)).error, "bad_type");
  assert.equal((await call("/api/portal/receipt", { image: "data:image/png;base64," + Buffer.alloc(9 * 1024 * 1024).toString("base64") }, ct)).error, "too_large");
  const ok = await call("/api/portal/receipt", { image: png, amount: 5000000, date: "۱۴۰۵/۰۸/۱۰" }, ct);
  assert.equal(ok.ok, true);
  assert.equal((await call("/api/portal/receipts", null, xt)).status, 401); // a portal token never reads the owner's list
  const row = (await call("/api/portal/receipts", null, owner)).receipts.find(r => r.partyName === "خانم احمدی");
  assert.equal(row.status, "pending");
  assert.equal(row.amount, 5000000);
  assert.equal((await fetch(base + "/api/portal/photo/" + row.blob, { headers: { Authorization: "Bearer " + ct } })).status, 200);
  assert.equal((await fetch(base + "/api/portal/photo/" + row.blob, { headers: { Authorization: "Bearer " + xt } })).status, 404); // another customer: denied
  for (let i = 0; i < 5; i++) assert.equal((await call("/api/portal/receipt", { image: png }, ct)).ok, true); // 3 so far + 5 = 8, the daily cap
  assert.equal((await call("/api/portal/receipt", { image: png }, ct)).error, "too_many");
  await call("/api/portal/receipt/" + row.id + "/done", {}, owner);
  assert.equal((await call("/api/portal/receipts", null, owner)).receipts.find(r => r.id === row.id).status, "done");
  // the customer sees its own receipts and which were recorded; another customer sees none of them
  const mine = (await call("/api/portal/receipts/mine", null, ct)).receipts;
  assert.equal(mine.length, 6); // this test sent 1 + 5 (the daily cap also counted two failed tries)
  assert.equal(mine.find(r => r.id === row.id).status, "done");
  assert.equal(mine.filter(r => r.status === "pending").length, 5);
  assert.ok(!("party" in mine[0]));
  assert.equal((await call("/api/portal/receipts/mine", null, xt)).receipts.length, 0);
  assert.equal((await call("/api/portal/receipts/mine")).status, 401);
});

test("a party switched off in the ledger (portalOff) gets no link, no sign-in and no data", async () => {
  const party = { name: "خاموش", kind: "customer", phone: "09125550000" };
  await call("/api/push", { changes: [{ c: "parties", id: "o1", d: party }] }, owner);
  await setLogin({ partyId: "o1", username: "khamoosh", password: "khamoosh1" });
  const k = (await call("/api/portal/invite", { partyId: "o1" }, owner)).k, t = (await call("/api/portal/redeem", { k })).token;
  const k2 = (await call("/api/portal/invite", { partyId: "o1" }, owner)).k; // an unused link, made before switching off
  assert.equal((await call("/api/portal/me", null, t)).status, 200);
  await call("/api/push", { changes: [{ c: "parties", id: "o1", d: { ...party, portalOff: true } }] }, owner);
  assert.equal((await call("/api/portal/me", null, t)).status, 403); // an open session sees nothing
  assert.equal((await call("/api/portal/redeem", { k: k2 })).error, "portal_off");
  assert.equal((await call("/api/portal/invite", { partyId: "o1" }, owner)).error, "portal_off");
  assert.equal((await login("khamoosh", "khamoosh1", "10.3.0.1")).error, "portal_off"); // its own password no longer opens it
  await call("/api/push", { changes: [{ c: "parties", id: "o1", d: party }] }, owner);
  assert.equal((await call("/api/portal/me", null, t)).status, 200); // on again: the same session works
});

test("«ویترین»: signed-in parties see only what is on show and its media; an order becomes a lead in the panel", async () => {
  const ct = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "c1" }, owner)).k })).token;
  const put = (id, type, bytes) => fetch(base + "/api/media/" + id, { method: "PUT", headers: { Authorization: "Bearer " + owner, "Content-Type": type }, body: bytes });
  assert.equal((await put("m-ring", "image/jpeg", Buffer.from([255, 216, 255]))).status, 200);
  assert.equal((await put("m-film", "video/mp4", Buffer.from([0, 0, 0, 24]))).status, 200);
  assert.equal((await put("m-page", "text/html", Buffer.from("<b>"))).status, 400); // only photos and films
  assert.equal((await fetch(base + "/api/media/m-x", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: Buffer.from([1]) })).status, 401); // the owner only
  await call("/api/push", { changes: [
    { c: "vitrin", id: "v1", d: { name: "انگشتر سولیتر", code: "R12", cat: "انگشتر", weight: 3.4567, carat: 750, ajrat: 18, profit: 7, settle: ["نقد", "طلا با طلا"], desc: "نگین زیرکونیا", cost: 999, note: "خرید از کارگاه نیک", media: [{ id: "m-ring", type: "image" }, { id: "m-film", type: "video" }], show: true, ts: "2026-11-01T00:00:00Z" } },
    { c: "vitrin", id: "v2", d: { name: "پیش‌نویس", media: [{ id: "m-hidden", type: "image" }], show: false, ts: "2026-11-02T00:00:00Z" } },
  ] }, owner);
  await put("m-hidden", "image/png", Buffer.from([137, 80]));
  const v = await call("/api/portal/vitrin", null, ct);
  assert.equal(v.items.length, 1);
  assert.equal(v.items[0].weight, 3.457);
  assert.deepEqual(v.items[0].settle, ["نقد", "طلا با طلا"]);
  assert.ok(!JSON.stringify(v).includes("999") && !JSON.stringify(v).includes("کارگاه")); // never the owner's cost or notes
  assert.equal((await call("/api/portal/vitrin")).status, 401);
  const media = id => fetch(base + "/api/portal/media/" + id, { headers: { Authorization: "Bearer " + ct } });
  const film = await media("m-film");
  assert.equal(film.status, 200);
  assert.equal(film.headers.get("content-type"), "video/mp4");
  assert.equal((await media("m-hidden")).status, 404); // not on show
  assert.equal((await fetch(base + "/api/portal/media/m-ring")).status, 401);
  assert.equal((await fetch(base + "/api/blob/m-ring", { headers: { Authorization: "Bearer " + owner } })).status, 200); // the ledger shows it too
  // media never reaches the devices' own sync
  const pulled = await call("/api/pull?since=0", null, owner);
  assert.ok(!pulled.blobs.includes("m-film"));
  assert.equal((await call("/api/portal/vitrin/order", { id: "v2" }, ct)).status, 404);
  assert.equal((await call("/api/portal/vitrin/order", { id: "v1", note: "سایز ۵۲" }, ct)).ok, true);
  const lead = (await call("/api/pull?since=0", null, owner)).changes.find(x => x.c === "crm_leads");
  assert.equal(lead.d.partyId, "c1");
  assert.equal(lead.d.status, "waiting"); // it waits two minutes for Leon to confirm it (owner, 2026-11-09)
  assert.match(lead.d.what, /انگشتر سولیتر \(R12\)/);
  assert.equal(lead.d.note, "سایز ۵۲");
  // not available at all: shown as such, and no order is taken
  await call("/api/push", { changes: [{ c: "vitrin", id: "v3", d: { name: "ناموجود", stock: "none", show: true, ts: "2026-11-03T00:00:00Z" } }] }, owner);
  const v3 = (await call("/api/portal/vitrin", null, ct)).items.find(x => x.id === "v3");
  assert.equal(v3.stock, "none");
  assert.equal(v.items[0].stock, "order");
  assert.equal((await call("/api/portal/vitrin/order", { id: "v3" }, ct)).status, 409);
});

test("a transfer order (حواله) on another party's wholesale invoice moves this party's gold the other way, shown as in the ledger", async () => {
  await call("/api/push", { changes: [
    { c: "parties", id: "ab1", d: { name: "آبشده‌فروش", kind: "supplier", openG: 100, ts: "2026-01-01T00:00:00Z" } },
    { c: "invoices", id: "ih1", d: { kind: "whole", doc: "rc", no: "9", partyId: "x1", partyName: "دیگری", deltaG: 0, ts: "2026-03-01T00:00:00Z", hav: { partyId: "ab1", partyName: "آبشده‌فروش", w: 10, dir: "out" } } },
  ] }, owner);
  const t = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "ab1" }, owner)).k })).token;
  const a = (await call("/api/portal/me", null, t)).accounts[0];
  assert.equal(a.bal.g, 90);
  assert.equal(a.ent[0].d, -10);
  assert.equal(a.ent[0].label, "حواله از حساب لئون به دیگری · سند دریافتی عمده 9");
});

test("a party marked as a customer but picked as an order's supplier sees that work too", async () => {
  await call("/api/push", { changes: [{ c: "orders", id: "ord-w2", d: { partyId: "c1", partyName: "خانم احمدی", status: "new", due: "۱۴۰۵/۰۹/۱۰", ts: "2026-03-02T00:00:00Z",
    items: [{ desc: "دستبند", qty: 1, weight: 5, carat: 750, supId: "x1", supName: "دیگری" }] } }] }, owner);
  const t = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "x1" }, owner)).k })).token;
  const a = (await call("/api/portal/me", null, t)).accounts[0];
  assert.equal(a.kind, "customer");
  assert.equal(a.work.length, 1);
  assert.equal(a.work[0].desc, "دستبند");
  assert.ok(!JSON.stringify(a.work).includes("احمدی"));
});

test("a piece shown only to some parties: the others see neither it, its media nor can order it; the list of whom never leaves", async () => {
  await fetch(base + "/api/media/m-only", { method: "PUT", headers: { Authorization: "Bearer " + owner, "Content-Type": "image/jpeg" }, body: Buffer.from([255, 216, 255]) });
  await call("/api/push", { changes: [{ c: "vitrin", id: "vonly", d: { name: "سرویس ویژه", weight: 20, show: true, stock: "qty", qty: 1, to: ["c1"], media: [{ id: "m-only", type: "image" }], ts: "2026-05-01T00:00:00Z" } }] }, owner);
  const enter = async id => (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: id }, owner)).k })).token;
  const c1 = await enter("c1"), x1 = await enter("x1");
  const mine = (await call("/api/portal/vitrin", null, c1)).items, theirs = (await call("/api/portal/vitrin", null, x1)).items;
  assert.ok(mine.some(i => i.id === "vonly"));
  assert.ok(!theirs.some(i => i.id === "vonly"));
  assert.ok(!JSON.stringify(mine).includes('"to"'));
  assert.equal((await fetch(base + "/api/portal/media/m-only", { headers: { Authorization: "Bearer " + c1 } })).status, 200);
  assert.equal((await fetch(base + "/api/portal/media/m-only", { headers: { Authorization: "Bearer " + x1 } })).status, 404);
  assert.equal((await call("/api/portal/vitrin/order", { id: "vonly" }, x1)).error, "not_found");
});

test("only the owner makes links; revoke signs the party out", async () => {
  assert.equal((await call("/api/portal/invite", { partyId: "c1" })).status, 401);
  const k = (await call("/api/portal/invite", { partyId: "c1" }, owner)).k, t = (await call("/api/portal/redeem", { k })).token;
  assert.equal((await call("/api/portal/me", null, t)).status, 200);
  await call("/api/portal/revoke", { partyId: "c1" }, owner);
  assert.equal((await call("/api/portal/me", null, t)).status, 401);
  server.close();
});
