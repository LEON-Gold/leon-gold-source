// The ledger is the owner's alone: only SETUP_USER signs in, any other login (or a session left over from one) is
// refused. The owner also hands the management panel a one-time code. Runs on a throwaway data folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-auth-"));
process.env.ALLOWED_ORIGINS = "https://leon-gold.github.io";
process.env.SETUP_USER = "مالک";
process.env.SETUP_PASS = "Leon1405";
const { server, setUser, db } = await import("../server.mjs");
setUser("کارمند", "1111"); // a login made before the ledger became owner-only
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (p, o = {}) => fetch(base + p, { ...o, headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}), ...o.headers } });
const login = async (u, p) => call("/api/login", { method: "POST", body: JSON.stringify({ u, p, device: "test" }) });

test("the owner signs in, with a password that has letters too", async () => {
  const j = await (await login("مالک", "Leon1405")).json();
  assert.ok(j.token);
  assert.equal((await call("/api/state", { token: j.token })).status, 200);
});

test("any other login is refused, exactly like a wrong password", async () => {
  const r = await login("کارمند", "1111");
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "bad_login");
});

test("a session left from a non-owner login opens nothing", async () => {
  const t = crypto.randomBytes(32).toString("base64url"), now = new Date().toISOString();
  db.prepare("INSERT INTO sessions (token, user, device, created, seen) VALUES (?, ?, ?, ?, ?)").run(crypto.createHash("sha256").update(t).digest("hex"), "کارمند", "old", now, now);
  assert.equal((await call("/api/state", { token: t })).status, 401);
  assert.equal((await call("/api/portal/receipts", { token: t })).status, 401);
});

test("a new device signs in with the ledger's own sign-in (settings/lock, synced), as the owner", async () => {
  const owner = (await (await login("مالک", "Leon1405")).json()).token;
  const salt = "s4lt", hash = crypto.createHash("sha256").update(salt + "|2580").digest("hex");
  await call("/api/push", { method: "POST", token: owner, body: JSON.stringify({ changes: [{ c: "settings", id: "lock", d: { users: [{ u: "Ali Eshghi", hash, salt }], ts: 1 } }] }) });
  const r = await login("ali  eshghi", "۲۵۸۰"); // spacing, capitals and Persian digits as the phone types them
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.user, "مالک");
  assert.equal((await call("/api/state", { token: j.token })).status, 200);
  assert.equal((await login("Ali Eshghi", "2581")).status, 401);
  assert.equal((await login("someone", "2580")).status, 401);
  assert.equal((await login("Ali Eshghi", "")).status, 401);
});

test("a ledger password set the new way (PBKDF2, kdf «p2») signs in too; a wrong one does not", async () => {
  const owner = (await (await login("مالک", "Leon1405")).json()).token;
  const salt = "n3wsalt", hash = crypto.pbkdf2Sync("135790", salt, 150000, 32, "sha256").toString("hex");
  await call("/api/push", { method: "POST", token: owner, body: JSON.stringify({ changes: [{ c: "settings", id: "lock", d: { users: [{ u: "Sara", hash, salt, kdf: "p2" }], ts: 2 } }] }) });
  assert.equal((await login("sara", "۱۳۵۷۹۰")).status, 200);
  assert.equal((await login("sara", "135791")).status, 401);
  // the old way's hash of the same password does not open a p2 record
  await call("/api/push", { method: "POST", token: owner, body: JSON.stringify({ changes: [{ c: "settings", id: "lock", d: { users: [{ u: "Sara", hash: crypto.createHash("sha256").update(salt + "|135790").digest("hex"), salt, kdf: "p2" }], ts: 3 } }] }) });
  assert.equal((await login("sara", "135790")).status, 401);
  // with letters
  const h2 = crypto.pbkdf2Sync("Gold۱۴05x".replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)), salt, 150000, 32, "sha256").toString("hex");
  await call("/api/push", { method: "POST", token: owner, body: JSON.stringify({ changes: [{ c: "settings", id: "lock", d: { users: [{ u: "Sara", hash: h2, salt, kdf: "p2", alpha: true }], ts: 4 } }] }) });
  assert.equal((await login("sara", "Gold۱۴05x")).status, 200);
  assert.equal((await login("sara", "Gold1405x")).status, 200);
  assert.equal((await login("sara", "gold1405x")).status, 401);
});

test("the staff-account endpoints are gone", async () => {
  const owner = (await (await login("مالک", "Leon1405")).json()).token;
  assert.equal((await call("/api/users", { token: owner })).status, 404);
});

test("spacing in a ledger-lock name does not give a new try counter", async () => {
  const as = (n, u, p) => call("/api/login", { method: "POST", headers: { "X-Forwarded-For": "10.7.0." + n }, body: JSON.stringify({ u, p }) });
  for (let i = 1; i <= 20; i++) await as(i, "Ali" + " ".repeat(i) + "Eshghi", "0000"); // (a few tries were already spent above)
  assert.equal((await as(99, "Ali Eshghi", "2580")).status, 429);
});

test("the ledger hands the panel a one-time code that works once and gives a session of its own", async () => {
  const owner = (await (await login("مالک", "Leon1405")).json()).token;
  const { code, ttl } = await (await call("/api/handoff", { method: "POST", token: owner, body: "{}" })).json();
  assert.ok(code && ttl === 60);
  const got = await (await call("/api/handoff/redeem", { method: "POST", body: JSON.stringify({ code }) })).json();
  assert.ok(got.token && got.token !== owner);
  assert.equal((await call("/api/state", { token: got.token })).status, 200);
  assert.equal((await call("/api/handoff/redeem", { method: "POST", body: JSON.stringify({ code }) })).status, 401, "the code works only once");
  assert.equal((await call("/api/handoff/redeem", { method: "POST", body: JSON.stringify({ code: "made-up" }) })).status, 401);
});

test("every answer carries the security headers", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'; frame-ancestors 'none'/);
  assert.match(r.headers.get("strict-transport-security"), /max-age=31536000/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  server.close();
});
