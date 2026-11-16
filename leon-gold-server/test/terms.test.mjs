// «حساب من»: on first entry the party signs the rules electronically (the exact text, time, address, browser are kept),
// then may fill in its own details; the owner sees both from the ledger.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-terms-"));
const { server, setUser } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token, ua) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(ua ? { "User-Agent": ua } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
await call("/api/push", { changes: [{ c: "parties", id: "c1", d: { name: "مشتری", kind: "customer" } }] }, owner);
const t = (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: "c1" }, owner)).k })).token;
const RULES = "آیین‌نامه‌ی خرید و فروش لئون گلد: ۱. اشتباه از طرفین قابل برگشت است.";

test("a new party has signed nothing; signing keeps the exact text, the time, its address and browser", async () => {
  assert.equal((await call("/api/portal/me", null, t)).terms, null);
  assert.equal((await call("/api/portal/terms/accept", { text: RULES, label: "خواندم" })).status, 401);
  assert.equal((await call("/api/portal/terms/accept", { text: "کوتاه", label: "x" }, t)).error, "bad_terms");
  const a = await call("/api/portal/terms/accept", { text: RULES, label: "آیین‌نامه را خواندم و می‌پذیرم" }, t, "iPhone Safari");
  assert.equal(a.ok, true);
  const me = await call("/api/portal/me", null, t);
  assert.equal(me.terms.hash, a.hash);
  const seen = await call("/api/portal/party?id=c1", null, owner);
  assert.equal(seen.accepts.length, 1);
  assert.equal(seen.accepts[0].text, RULES);
  assert.equal(seen.accepts[0].ua, "iPhone Safari");
  assert.equal(seen.accepts[0].label, "آیین‌نامه را خواندم و می‌پذیرم");
  assert.ok(seen.accepts[0].ip);
  assert.equal((await call("/api/portal/party?id=c1", null, t)).status, 401); // only the owner
});

test("the party's own details: optional, trimmed, only the known fields; the owner sees them", async () => {
  assert.equal((await call("/api/portal/info", {}, t)).ok, true); // nothing is required
  const r = await call("/api/portal/info", { fullName: "  علی رضایی ", mobile: "09120000000", address: "تهران", hack: "x", nationalId: "123456789012345" }, t);
  assert.deepEqual(r.info, { fullName: "علی رضایی", nationalId: "1234567890", mobile: "09120000000", address: "تهران" });
  assert.equal((await call("/api/portal/me", null, t)).info.fullName, "علی رضایی");
  assert.equal((await call("/api/portal/party?id=c1", null, owner)).info.address, "تهران");

  // a VIP (marked on the ledger card) gets its VIP card
  assert.equal((await call("/api/portal/me", null, t)).accounts[0].vip, false);
  await call("/api/push", { changes: [{ c: "parties", id: "c1", d: { name: "مشتری", kind: "customer", vip: true, biz: "gallery" } }] }, owner);
  assert.equal((await call("/api/portal/me", null, t)).accounts[0].vip, true);
  // an invoice paid in full inside itself (goods 10 g, 10 g of gold received): net zero, but its own total travels with it
  await call("/api/push", { changes: [{ c: "invoices", id: "iz", d: { kind: "whole", doc: "pd", no: "9", partyId: "c1", amount: 10, deltaG: 0, ts: "2026-03-01T00:00:00Z", items: [{ desc: "النگو", qty: 1, weight: 10, carat: 750, totalG: 10 }] } }] }, owner);
  const e = (await call("/api/portal/me", null, t)).accounts[0].ent.find(x => x.label === "فاکتور عمده 9");
  assert.deepEqual([e.d, e.gross, e.lines.length], [0, 10, 1]);
  server.close();
});
