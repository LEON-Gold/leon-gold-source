// The site's order form (owner, 2026-11-14): «ثبت سفارش» goes to the ledger, not to Telegram. A visitor's request is filed
// as a new lead (crm_leads, source «سایت»); no sign-in, so it is checked, slowed down per address, and a robot's is dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-siteorder-"));
const { server, setUser } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token, ip) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
const leads = async () => (await call("/api/pull?since=0", null, owner)).changes.filter(c => c.c === "crm_leads" && c.d).map(c => c.d);

test("a visitor's order lands in the ledger as a new lead from «سایت»", async () => {
  const r = await call("/api/public/order", { name: "  سارا   رضایی ", phone: "۰۹۱۲ ۱۲۳ ۴۵۶۷", what: "انگشتر", note: "سایز ۵۲\nحدود ۳ گرم <b>", website: "" }, null, "10.1.0.1");
  assert.deepEqual([r.status, r.ok], [200, true]);
  const L = await leads();
  assert.equal(L.length, 1);
  const l = L[0];
  assert.equal(l.source, "سایت"); assert.equal(l.status, "new"); assert.equal(l.name, "سارا رضایی"); assert.equal(l.phone, "09121234567");
  assert.equal(l.what, "انگشتر"); assert.equal(l.note, "سایز ۵۲ حدود ۳ گرم b"); assert.ok(l.id.startsWith("ld")); assert.equal(l.partyId, undefined);
});

test("it is checked: a name, a full phone number", async () => {
  assert.equal((await call("/api/public/order", { name: "x", phone: "09121234567" }, null, "10.1.0.2")).error, "bad_name");
  assert.equal((await call("/api/public/order", { name: "علی", phone: "0912" }, null, "10.1.0.2")).error, "bad_phone");
  assert.equal((await call("/api/public/order", { name: "علی", phone: "09121234567123456" }, null, "10.1.0.2")).error, "bad_phone");
});

test("a robot that fills the hidden field is answered but nothing is filed", async () => {
  const before = (await leads()).length;
  assert.equal((await call("/api/public/order", { name: "Bot", phone: "09120000000", website: "http://spam" }, null, "10.1.0.3")).ok, true);
  assert.equal((await leads()).length, before);
});

test("at most 5 an hour from one address; another address is not held up", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call("/api/public/order", { name: "مشتری " + i, phone: "0912000000" + i }, null, "10.1.0.4")).ok, true);
  assert.equal((await call("/api/public/order", { name: "مشتری ۶", phone: "09120000006" }, null, "10.1.0.4")).error, "too_many");
  assert.equal((await call("/api/public/order", { name: "دیگری", phone: "09120000007" }, null, "10.1.0.5")).ok, true);
});

test("GET is not an order", async () => {
  assert.equal((await call("/api/public/order")).status, 404);
});

test.after(() => server.close());
