// Bank SMS from the owner's iPhone shortcut (owner, 2026-11-15): read, filed for the ledger, only with the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-banksms-"));
const { server, setUser } = await import("../server.mjs");
const sms = await import("../banksms.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => { const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;

// the owner's own Mellat message (2026-11-15)
const MELLAT = "حساب9060005609\nبرداشت70,032,000\nمانده9,582,406\n05/08/20-12:17";

test("the owner's Mellat message is read", () => {
  assert.deepEqual(sms.parse(MELLAT), { bank: "mellat", dir: "out", amount: 70032000, bal: 9582406, date: "1405/08/20", time: "12:17" });
});

// the owner's Blu (Saman) message (2026-11-15)
const BLU = "بلو\nبرداشت پول\nعلی عزیز، 1,980,000ریال از حساب شما پرید.\nموجودی: 88,069,637 ریال\n۲۲:۵۲\n۱۴۰۵.۰۸.۲۴";
test("the owner's Blu message is read as Saman", () => {
  assert.deepEqual(sms.parse(BLU), { bank: "saman", dir: "out", amount: 1980000, bal: 88069637, date: "1405/08/24", time: "22:52" });
});

test("other shapes: Persian digits, a deposit, a signed amount, Saman by name", () => {
  assert.deepEqual(sms.parse("حساب۹۰۶۰۰۰۵۶۰۹\nواریز۱۲,۰۰۰,۰۰۰\nمانده۲۱,۵۸۲,۴۰۶\n۰۵/۰۸/۲۱-۰۹:۰۵"), { bank: "mellat", dir: "in", amount: 12000000, bal: 21582406, date: "1405/08/21", time: "09:05" });
  const s = sms.parse("بانک سامان\nانتقال\n-5,000,000\nمانده: 3,000,000");
  assert.equal(s.bank, "saman"); assert.equal(s.dir, "out"); assert.equal(s.amount, 5000000); assert.equal(s.bal, 3000000);
  assert.equal(sms.parse("خرید 250,000 ریال کارت ...8451 مانده 1,000,000").bank, "saman");
});

test("only with the key; a new key ends the old one; the message becomes a ledger document", async () => {
  assert.equal((await call("/api/public/banksms", { k: "nope", text: MELLAT })).status, 401);
  const k1 = (await call("/api/banksms/key", {}, owner)).key, k2 = (await call("/api/banksms/key", {}, owner)).key;
  assert.ok(k1 && k2 && k1 !== k2);
  assert.equal((await call("/api/public/banksms", { k: k1, text: MELLAT })).status, 401);
  const r = await call("/api/public/banksms", { k: k2, text: MELLAT });
  assert.equal(r.status, 200); assert.deepEqual([r.bank, r.dir, r.amount, r.bal], ["mellat", "out", 70032000, 9582406]);
  const pulled = await (await fetch(base + "/api/pull?since=0", { headers: { Authorization: "Bearer " + owner } })).json();
  const d = pulled.changes.filter(c => c.c === "bankmsgs" && c.d);
  assert.equal(d.length, 1); assert.equal(d[0].d.text, MELLAT); assert.equal(d[0].d.date, "1405/08/20");
  assert.equal((await call("/api/banksms/key", {})).status, 401);   // a new key needs the owner signed in
  // the same message again is not filed twice
  const again = await call("/api/public/banksms", { k: k2, text: MELLAT });
  assert.equal(again.status, 200); assert.equal(again.dup, true);
  const p2 = await (await fetch(base + "/api/pull?since=0", { headers: { Authorization: "Bearer " + owner } })).json();
  assert.equal(p2.changes.filter(c => c.c === "bankmsgs" && c.d).length, 1);
});

test.after(() => server.close());
