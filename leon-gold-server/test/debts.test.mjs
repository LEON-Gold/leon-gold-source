// The week's debts for the owner (owner, 2026-11-15): Saturdays from 10:00 Tehran time, once a week, the debtors largest
// first; a party that owes nothing is left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-debts-"));
const { server, setUser, db } = await import("../server.mjs");
const debts = await import("../debts.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => (await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
await call("/api/push", { changes: [
  { c: "parties", id: "a", d: { name: "علی", openG: 2.5 } },
  { c: "parties", id: "b", d: { name: "بهار", openR: 30000000 } },
  { c: "parties", id: "c", d: { name: "کاوه", openG: -4 } },   // Leon owes him: not a debtor
  { c: "parties", id: "d", d: { name: "دلارام", openG: 1 } },
  { c: "invoices", id: "i1", d: { kind: "whole", partyId: "d", deltaG: -1, ts: "2026-11-01T10:00:00Z" } },   // settled to zero
] }, owner);

test("Tehran time, whatever the server's zone", () => {
  // 2026-11-14 is a Saturday; 07:00 UTC = 10:30 in Tehran
  assert.deepEqual(debts.tehran(new Date("2026-11-14T07:00:00Z")), { day: 6, hour: 10, date: "2026-11-14" });
  assert.equal(debts.tehran(new Date("2026-11-14T05:00:00Z")).hour, 8);
});

test("the debtors, largest first; nobody who owes nothing", () => {
  const L = debts.debtors(db);
  assert.deepEqual(L.map(x => x.name), ["علی", "بهار"]);
  const m = debts.message(L);
  assert.match(m.title, /یادآوری هفتگی بدهی‌ها · ۲ بدهکار/);
  assert.match(m.body, /علی \(۲٫۵ گرم\)/);
  assert.match(m.body, /بهار \(۳۰٬۰۰۰٬۰۰۰ ریال\)/);
  assert.match(m.body, /جمع: ۲٫۵ گرم و ۳۰٬۰۰۰٬۰۰۰ ریال/);
});

test("once a week, Saturday from 10:00 Tehran time", () => {
  const sent = [], tell = (m, c) => sent.push([m, c]);
  assert.equal(debts.weekly(db, tell, new Date("2026-11-13T07:00:00Z")), false);   // Friday
  assert.equal(debts.weekly(db, tell, new Date("2026-11-14T05:00:00Z")), false);   // Saturday 08:30
  assert.equal(debts.weekly(db, tell, new Date("2026-11-14T07:00:00Z")), true);    // Saturday 10:30
  assert.equal(debts.weekly(db, tell, new Date("2026-11-14T12:00:00Z")), false);   // same Saturday again
  assert.equal(debts.weekly(db, tell, new Date("2026-11-21T07:00:00Z")), true);    // next Saturday
  assert.equal(sent.length, 2); assert.equal(sent[0][1], "parties");
});

test("nobody owes: still a short note", () => {
  assert.match(debts.message([]).body, /کسی به لئون گلد بدهکار نیست/);
});

test.after(() => server.close());
