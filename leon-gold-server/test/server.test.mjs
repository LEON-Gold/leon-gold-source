// Runs the server on a throwaway data folder and walks two devices through login, push, pull and photos.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-srv-"));
process.env.ALLOWED_ORIGINS = "https://leon-gold.github.io";
const { server, setUser, backup } = await import("../server.mjs");
setUser("علی", "۱۲۳۴");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (p, o = {}) => fetch(base + p, { ...o, headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}), ...o.headers } });
const login = async (u, p) => (await call("/api/login", { method: "POST", body: JSON.stringify({ u, p, device: "test" }) })).json();

test("login: Persian and Latin digits are the same password; wrong password refused", async () => {
  assert.ok((await login("علی", "1234")).token);
  assert.equal((await login("علی", "9999")).error, "bad_login");
  assert.equal((await call("/api/state")).status, 401);
});

test("two devices: a change on one reaches the other, deletions too", async () => {
  const phone = (await login("علی", "1234")).token, pc = (await login("علی", "۱۲۳۴")).token;
  const pushed = await (await call("/api/push", { method: "POST", token: phone, body: JSON.stringify({ changes: [
    { c: "parties", id: "p1", d: { name: "همکار یک", gram: 12.5 } }, { c: "invoices", id: "i1", d: { party: "p1", lines: [{ w: 3.2, c: 750 }] } }] }) })).json();
  const first = await (await call("/api/pull?since=0", { token: pc })).json();
  assert.equal(first.rev, pushed.rev);
  assert.deepEqual(first.changes.map(c => c.c + "/" + c.id).sort(), ["invoices/i1", "parties/p1"]);
  await call("/api/push", { method: "POST", token: pc, body: JSON.stringify({ changes: [{ c: "parties", id: "p1", d: null }] }) });
  const next = await (await call("/api/pull?since=" + first.rev, { token: phone })).json();
  assert.deepEqual(next.changes, [{ c: "parties", id: "p1", d: null }]);
  assert.equal((await (await call("/api/state", { token: pc })).json()).docs, 1);
});

test("photos upload once and come back byte for byte", async () => {
  const t = (await login("علی", "1234")).token, bytes = new Uint8Array([1, 2, 3, 250]);
  await fetch(base + "/api/blob/ph1", { method: "PUT", headers: { Authorization: "Bearer " + t, "Content-Type": "image/png" }, body: bytes });
  const r = await fetch(base + "/api/blob/ph1", { headers: { Authorization: "Bearer " + t } });
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  assert.ok((await (await call("/api/pull?since=0", { token: t })).json()).blobs.includes("ph1"));
});

test("bad collection names are refused and nothing is half-written", async () => {
  const t = (await login("علی", "1234")).token, before = (await (await call("/api/state", { token: t })).json()).rev;
  const r = await call("/api/push", { method: "POST", token: t, body: JSON.stringify({ changes: [{ c: "parties", id: "ok", d: {} }, { c: "../x", id: "y", d: {} }] }) });
  assert.equal(r.status, 400);
  assert.equal((await (await call("/api/state", { token: t })).json()).rev, before);
});

test("a null body or a null change in the array is refused, not a server error", async () => {
  const t = (await login("علی", "1234")).token, before = (await (await call("/api/state", { token: t })).json()).rev;
  assert.equal((await call("/api/push", { method: "POST", token: t, body: "null" })).status, 400);
  assert.equal((await call("/api/push", { method: "POST", token: t, body: JSON.stringify([1, 2]) })).status, 400);
  const r = await call("/api/push", { method: "POST", token: t, body: JSON.stringify({ changes: [{ c: "parties", id: "ok", d: {} }, null] }) });
  assert.equal(r.status, 400);
  assert.equal((await (await call("/api/state", { token: t })).json()).rev, before);
});

test("CORS only for the app's address", async () => {
  const ok = await call("/api/health", { headers: { Origin: "https://leon-gold.github.io" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://leon-gold.github.io");
  const no = await call("/api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(no.headers.get("access-control-allow-origin"), null);
});

test("a new password signs out old devices; repeated wrong logins are blocked", async () => {
  const t = (await login("علی", "1234")).token;
  setUser("علی", "5678");
  assert.equal((await call("/api/state", { token: t })).status, 401);
  for (let i = 0; i < 10; i++) await login("علی", "0000");
  assert.equal((await call("/api/login", { method: "POST", body: JSON.stringify({ u: "علی", p: "5678" }) })).status, 429);
});

test("a new address on every try does not get round the limit: the username is blocked too", async () => {
  setUser("حسن", "4321");
  const as = (n, p) => call("/api/login", { method: "POST", headers: { "X-Forwarded-For": "10.0.0." + n }, body: JSON.stringify({ u: "حسن", p }) });
  for (let i = 0; i < 20; i++) assert.equal((await as(i, "0000")).status, 401);
  assert.equal((await as(99, "4321")).status, 429);
  assert.equal((await as(98, "1111")).status, 429);
});

test("daily backup file is written", () => {
  const f = backup();
  assert.ok(f && fs.statSync(f).size > 0);
});

test("/api/wait answers at once when there is something newer, else as soon as something is saved", async () => {
  setUser("رضا", "2468");
  const t = (await (await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9.0.1" }, body: JSON.stringify({ u: "رضا", p: "2468" }) })).json()).token;
  const H = { Authorization: "Bearer " + t, "Content-Type": "application/json" };
  const rev = (await (await fetch(base + "/api/state", { headers: H })).json()).rev;
  assert.equal((await (await fetch(base + "/api/wait?since=" + (rev - 1), { headers: H })).json()).rev, rev);
  const t0 = Date.now(), waiting = fetch(base + "/api/wait?since=" + rev, { headers: H }).then(r => r.json());
  await new Promise(r => setTimeout(r, 300));
  await fetch(base + "/api/push", { method: "POST", headers: H, body: JSON.stringify({ changes: [{ c: "crm_leads", id: "w1", d: { name: "x" } }] }) });
  const got = await waiting;
  assert.ok(got.rev > rev, JSON.stringify({ got, rev })); assert.ok(Date.now() - t0 < 3000, "answered on the save, not after the wait");
  assert.equal((await fetch(base + "/api/wait?since=0")).status, 401);
  server.close();
});
