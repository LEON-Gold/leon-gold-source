// «روتین من» (gym.mjs): its own logins and data, kept apart from the ledger. Runs on a throwaway data folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-gym-"));
process.env.SETUP_USER = "مالک";
process.env.SETUP_PASS = "Leon1405";
// a stand-in for the AI service: refuses response_format once (like some services do), then answers per kind
import http from "node:http";
const aiCalls = [];
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    const j = JSON.parse(b); aiCalls.push(j);
    if (j.response_format && aiCalls.length === 1) { res.writeHead(400); return res.end("{}"); }
    const ask = j.messages[1].content[0].text;
    const out = /body-composition/.test(ask) ? { weight: 80.5, fat: 25 } : { sessions: [{ name: "سینه", ex: [{ n: "پرس", r: "۴×۱۰" }] }] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] }));
  });
});
await new Promise(r => ai.listen(0, r));
process.env.GYM_AI_URL = `"http://127.0.0.1:${ai.address().port}/v1/"`;
process.env.GYM_AI_KEY = "test-key";
const { server } = await import("../server.mjs");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = (p, o = {}) => fetch(base + p, { ...o, headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: "Bearer " + o.token } : {}), ...o.headers } });
const post = (p, body, token, ip) => call(p, { method: "POST", body: JSON.stringify(body), token, headers: ip ? { "X-Forwarded-For": ip } : {} });
const login = async (u, p, ip) => (await post("/api/gym/login", { u, p }, null, ip)).json();

test("the first admin exists on a new database and Persian digits work in the password", async () => {
  const j = await login("LEON", "۱۳۸۴۱۳");
  assert.ok(j.token); assert.equal(j.user, "leon"); assert.equal(j.role, "admin");
});

test("a gym login never opens the ledger, and a ledger login never opens the gym", async () => {
  const g = (await login("leon", "138413")).token;
  assert.equal((await call("/api/state", { token: g })).status, 401);
  assert.equal((await call("/api/pull", { token: g })).status, 401);
  const ledger = (await (await post("/api/login", { u: "مالک", p: "Leon1405", device: "t" })).json()).token;
  assert.ok(ledger);
  assert.equal((await call("/api/gym/data", { token: ledger })).status, 401);
  assert.equal((await call("/api/gym/users", { token: ledger })).status, 401);
});

test("data: write with the rev it was based on; a stale write gets 409 and the current copy", async () => {
  const t = (await login("leon", "138413")).token;
  assert.deepEqual(await (await call("/api/gym/data", { token: t })).json(), { rev: 0, data: null });
  const w1 = await call("/api/gym/data", { method: "PUT", token: t, body: JSON.stringify({ base: 0, data: { a: 1 } }) });
  assert.equal((await w1.json()).rev, 1);
  assert.deepEqual(await (await call("/api/gym/data?rev=1", { token: t })).json(), { same: true, rev: 1 });
  const stale = await call("/api/gym/data", { method: "PUT", token: t, body: JSON.stringify({ base: 0, data: { a: 2 } }) });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { rev: 1, data: { a: 1 } });
  assert.equal((await call("/api/gym/data", { method: "PUT", token: t, body: JSON.stringify({ base: 1, data: [] }) })).status, 400);
});

test("admin adds a user; each user sees only their own data and files; a user can't manage users", async () => {
  const admin = (await login("leon", "138413")).token;
  assert.equal((await post("/api/gym/users/add", { u: "Sara", p: "123", role: "user" }, admin)).status, 400);
  assert.equal((await post("/api/gym/users/add", { u: "a b", p: "gol1234" }, admin)).status, 400);
  assert.equal((await post("/api/gym/users/add", { u: "Sara", p: "gol1234", role: "user" }, admin)).status, 200);
  assert.equal((await post("/api/gym/users/add", { u: "sara", p: "gol1234" }, admin)).status, 409);
  const sara = (await login("SARA", "gol1234")).token;
  assert.deepEqual((await (await call("/api/gym/data", { token: sara })).json()).data, null);
  assert.equal((await call("/api/gym/users", { token: sara })).status, 403);
  assert.equal((await post("/api/gym/users/add", { u: "x1x", p: "123456" }, sara)).status, 403);
  // files
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  assert.equal((await fetch(base + "/api/gym/file/abcdef0123", { method: "PUT", body: png, headers: { Authorization: "Bearer " + sara, "Content-Type": "image/png" } })).status, 200);
  assert.equal((await fetch(base + "/api/gym/file/abcdef0124", { method: "PUT", body: "<script>", headers: { Authorization: "Bearer " + sara, "Content-Type": "text/html" } })).status, 415);
  assert.equal((await call("/api/gym/file/abcdef0123", { token: admin })).status, 404); // not the admin's file
  assert.equal((await fetch(base + "/api/gym/file/abcdef0123", { method: "PUT", body: png, headers: { Authorization: "Bearer " + admin, "Content-Type": "image/png" } })).status, 409);
  const f = await call("/api/gym/file/abcdef0123", { token: sara });
  assert.equal(f.status, 200); assert.match(f.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), png);
  const list = (await (await call("/api/gym/users", { token: admin })).json()).users.map(u => u.name);
  assert.deepEqual(list, ["leon", "sara"]);
});

test("password: own change needs the old one and signs out other devices; admin reset keeps the data", async () => {
  const admin = (await login("leon", "138413")).token;
  await post("/api/gym/users/add", { u: "nika", p: "first12" }, admin);
  const a = (await login("nika", "first12")).token, b = (await login("nika", "first12")).token;
  await call("/api/gym/data", { method: "PUT", token: a, body: JSON.stringify({ base: 0, data: { kept: true } }) });
  assert.equal((await post("/api/gym/password", { old: "wrong", new: "second12" }, a)).status, 403);
  assert.equal((await post("/api/gym/password", { old: "first12", new: "second12" }, a)).status, 200);
  assert.equal((await call("/api/gym/me", { token: a })).status, 200);
  assert.equal((await call("/api/gym/me", { token: b })).status, 401);
  assert.equal((await post("/api/gym/users/password", { u: "nika", p: "third123" }, admin)).status, 200);
  assert.equal((await call("/api/gym/me", { token: a })).status, 401);
  const c = (await login("nika", "third123")).token;
  assert.deepEqual((await (await call("/api/gym/data", { token: c })).json()).data, { kept: true });
  assert.equal((await post("/api/gym/users/remove", { u: "leon" }, admin)).status, 400); // not yourself
  assert.equal((await post("/api/gym/users/remove", { u: "nika" }, admin)).status, 200);
  assert.equal((await call("/api/gym/me", { token: c })).status, 401);
  assert.equal((await login("nika", "third123")).token, undefined);
});

test("wrong passwords are limited per address and per username", async () => {
  for (let i = 0; i < 10; i++) await post("/api/gym/login", { u: "leon", p: "000000" }, null, "9.9.9.9");
  assert.equal((await post("/api/gym/login", { u: "leon", p: "138413" }, null, "9.9.9.9")).status, 429);
  for (let i = 0; i < 20; i++) await post("/api/gym/login", { u: "victim", p: "x" }, null, "1.1.1." + i);
  assert.equal((await post("/api/gym/login", { u: "victim", p: "x" }, null, "2.2.2.2")).status, 429);
});

test("the page is served at /gym/ and gym logins stay out of the off-site copy", async () => {
  const r = await fetch(base + "/gym", { redirect: "manual" });
  assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "/gym/");
  const pg = await fetch(base + "/gym/");
  assert.equal(pg.status, 200); assert.match(pg.headers.get("content-type"), /text\/html/);
  // the page's own policy lets its scripts, styles and API run, and nothing from elsewhere
  const csp = pg.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self' 'unsafe-inline'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  for (const p of ["/gym/../server.mjs", "/gym/%2e%2e%2fserver.mjs", "/gym/nothing.js"]) assert.notEqual((await fetch(base + p)).status, 200, p);
  const owner = (await (await post("/api/login", { u: "مالک", p: "Leon1405", device: "t" })).json()).token;
  const copy = await call("/api/backup", { token: owner });
  assert.equal(copy.status, 200);
  const f = path.join(process.env.DATA_DIR, "copy.db"); fs.writeFileSync(f, Buffer.from(await copy.arrayBuffer()));
  const { DatabaseSync } = await import("node:sqlite"), c = new DatabaseSync(f);
  assert.equal(c.prepare("SELECT count(*) AS n FROM gym_users").get().n, 0);
  assert.equal(c.prepare("SELECT count(*) AS n FROM gym_sessions").get().n, 0);
  assert.ok(c.prepare("SELECT count(*) AS n FROM gym_data").get().n >= 1); // the routines themselves are backed up
  c.close();
});

test("reading an uploaded sheet: images and text go to the AI service, its JSON comes back", async () => {
  const t = (await login("leon", "138413")).token;
  assert.equal((await call("/api/gym/me", { token: t }).then(r => r.json())).ai, true);
  const img = "data:image/jpeg;base64,/9j/AA==";
  const r = await post("/api/gym/extract", { kind: "tests", text: "Weight 80.5", images: [img, "javascript:alert(1)"] }, t);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).result, { weight: 80.5, fat: 25 });
  const last = aiCalls[aiCalls.length - 1];
  assert.equal(last.response_format, undefined); // retried without it after the 400
  assert.equal(last.messages[1].content.length, 2); // the text + the one valid image, the bad url dropped
  assert.equal((await post("/api/gym/extract", { kind: "workout", text: "روز ۱" }, t).then(r => r.json())).result.sessions[0].name, "سینه");
  assert.equal((await post("/api/gym/extract", { kind: "nope", text: "x" }, t)).status, 400);
  assert.equal((await post("/api/gym/extract", { kind: "diet", text: " ", images: [] }, t)).status, 400);
  assert.equal((await post("/api/gym/extract", { kind: "diet", text: "x" })).status, 401);
  assert.match(aiCalls[0].messages[1].content[0].text, /body-composition/);
  assert.equal((await fetch(base + "/gym/pdf.min.js")).headers.get("content-type"), "text/javascript; charset=utf-8");
});

test.after(() => { server.close(); ai.close(); });
