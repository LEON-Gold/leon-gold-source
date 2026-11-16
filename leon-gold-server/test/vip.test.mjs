// The way to VIP on «حساب من» (owner, 2026-11-13): the three steps counted from the ledger's own data, and the owner told once.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vip-"));
const { server, setUser } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
const push = changes => call("/api/push", { changes }, owner);
const ts = n => `2026-03-${String(n).padStart(2, "0")}T00:00:00Z`;
const me = async u => { const t = (await call("/api/portal/login", { u, p: "gold1234" })).token; return (await call("/api/portal/me", null, t)).accounts[0]; };
const step = (a, k) => a.vipWay.steps.find(s => s.k === k);

await push([
  { c: "parties", id: "a", d: { name: "طرف الف", kind: "customer", phone: "09120000001" } },
  { c: "parties", id: "v", d: { name: "طرف ویژه", kind: "customer", phone: "09120000002", vip: true } },
  // invited by «a»: two bought something, one did not yet
  { c: "parties", id: "f1", d: { name: "دعوتی ۱", kind: "customer", refBy: "a" } },
  { c: "parties", id: "f2", d: { name: "دعوتی ۲", kind: "customer", refBy: "a" } },
  { c: "parties", id: "f3", d: { name: "دعوتی ۳", kind: "customer", refBy: "a" } },
  { c: "invoices", id: "fi1", d: { kind: "retail", partyId: "f1", ts: ts(1), items: [{ weight: 1, carat: 18 }] } },
  { c: "invoices", id: "fi2", d: { kind: "whole", doc: "pd", partyId: "f2", ts: ts(1), items: [{ weight: 1, carat: 750 }] } },
  { c: "invoices", id: "fi3", d: { kind: "whole", doc: "rc", partyId: "f3", ts: ts(1), items: [{ weight: 5, carat: 750 }] } }, // Leon bought from it: not a sale
  // «a»: sales at 750-equivalent (a retail 18 karat ring, a wholesale piece with its own w750, a return), and a purchase that does not count
  { c: "invoices", id: "i1", d: { kind: "retail", partyId: "a", ts: ts(2), items: [{ weight: 100, carat: 18 }, { weight: 10, carat: 18, ret: true }] } },
  { c: "invoices", id: "i2", d: { kind: "whole", doc: "pd", partyId: "a", ts: ts(3), items: [{ weight: 200, carat: 900, w750: 240 }] } },
  { c: "invoices", id: "i3", d: { kind: "whole", doc: "rc", partyId: "a", ts: ts(4), items: [{ weight: 500, carat: 750 }] } },
  // settlements: received in rials and in grams count; paid out, the ledger's automatic «تعیین عیار» and a zero do not
  { c: "settlements", id: "s1", d: { partyId: "a", dir: "in", unit: "r", amount: 5000000, ts: ts(5) } },
  { c: "settlements", id: "s2", d: { partyId: "a", dir: "in", unit: "g", amount: 2.5, ts: ts(6) } },
  { c: "settlements", id: "s3", d: { partyId: "a", dir: "out", unit: "r", amount: 1000000, ts: ts(7) } },
  { c: "settlements", id: "s4", d: { partyId: "a", dir: "in", unit: "g", amount: 0.4, note: "تعیین عیار آبشده شرطی فاکتور ۱۲ · عیار ۷۴۰", ts: ts(8) } },
  { c: "settlements", id: "s5", d: { partyId: "a", dir: "in", unit: "r", amount: 0, ts: ts(9) } },
]);
for (const [pid, u] of [["a", "alef"], ["v", "vizhe"]]) assert.equal((await call("/api/portal/login/set", { partyId: pid, username: u, password: "gold1234" }, owner)).ok, true);

test("each step is counted from the ledger's own data, the owner's way", async () => {
  const a = await me("alef");
  assert.equal(a.vipWay.is, false);
  assert.deepEqual(a.vipWay.steps.map(s => s.k), ["settle", "grams", "invite"]);
  assert.deepEqual(step(a, "settle"), { k: "settle", have: 2, need: 4, done: false });
  assert.deepEqual(step(a, "grams"), { k: "grams", have: 330, need: 400, done: false }); // 100 - 10 (returned) + 240
  assert.deepEqual(step(a, "invite"), { k: "invite", have: 2, need: 3, done: false });
  assert.equal(a.vipWay.all, false);
});

test("a VIP party gets only {is:true} (vip itself stays the plain flag); nothing about the others leaks", async () => {
  const v = await me("vizhe");
  assert.deepEqual(v.vipWay, { is: true });
  const a = await me("alef");
  assert.ok(!JSON.stringify(a.vipWay).includes("دعوتی"));
});

test("all three done: the card says so and the owner is told once, in vip_ready", async () => {
  await push([
    { c: "settlements", id: "s6", d: { partyId: "a", dir: "in", unit: "r", amount: 1000, ts: ts(10) } },
    { c: "settlements", id: "s7", d: { partyId: "a", dir: "in", unit: "g", amount: 1, ts: ts(11) } },
    { c: "invoices", id: "i4", d: { kind: "retail", partyId: "a", ts: ts(12), items: [{ weight: 70, carat: 18 }] } },
    { c: "invoices", id: "fi4", d: { kind: "retail", partyId: "f3", ts: ts(12), items: [{ weight: 1, carat: 18 }] } },
  ]);
  const a = await me("alef");
  assert.equal(a.vipWay.all, true);
  assert.ok(a.vipWay.steps.every(s => s.done));
  const pull = async () => (await call("/api/pull?since=0", null, owner)).changes.filter(c => c.c === "vip_ready");
  let n = await pull();
  assert.equal(n.length, 1);
  assert.equal(n[0].id, "a"); assert.equal(n[0].d.name, "طرف الف");
  const first = n[0].d.ts;
  await me("alef"); // asked again: no second notice
  n = await pull();
  assert.equal(n.length, 1); assert.equal(n[0].d.ts, first);
  // still the owner's call: the party is not marked VIP by any of this
  assert.equal((await me("alef")).vipWay.is, false);
});

test.after(() => server.close());
