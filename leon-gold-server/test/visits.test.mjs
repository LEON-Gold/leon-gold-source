// The site's visits (owner, 2026-11-15): a hit per page, no address or person stored, the sums only for the ledger.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-visits-"));
const { server, setUser, db } = await import("../server.mjs");
const visits = await import("../visits.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const hit = (p, ip, ua = "phone") => fetch(base + "/api/public/hit", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip, "User-Agent": ua }, body: JSON.stringify({ p }) });
const owner = (await (await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "owner", p: "1234" }) })).json()).token;

test("which paths count", () => {
  assert.equal(visits.cleanPath("/vitrin/?g=all#x"), "/vitrin/");
  assert.equal(visits.cleanPath("/leon-gold-app/site/kids/"), "/kids/");
  assert.equal(visits.cleanPath("/kids"), "/kids/");
  assert.equal(visits.cleanPath("/"), "/");
  for (const p of ["/panel/", "/daftar/", "/api/x", "/apps/leon-gold.apk", "/_next/x.js", "javascript:alert(1)", "/" + "a".repeat(100), ""]) assert.equal(visits.cleanPath(p), null, p);
});

test("hits make views and visitors; the ledger reads the sums", async () => {
  for (const [p, ip] of [["/", "10.0.0.1"], ["/vitrin/", "10.0.0.1"], ["/vitrin/", "10.0.0.2"], ["/panel/", "10.0.0.3"]]) assert.equal((await hit(p, ip)).status, 204);
  const r = await fetch(base + "/api/visits", { headers: { Authorization: "Bearer " + owner } }), s = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual([s.today.views, s.today.visitors, s.online], [3, 2, 2]);
  assert.equal(s.week.length, 7);
  assert.deepEqual(s.top[0], { path: "/vitrin/", n: 2 });
});

test("nothing that names a person is kept", () => {
  const dump = JSON.stringify([db.prepare("SELECT * FROM visit_pages").all(), db.prepare("SELECT * FROM visit_people").all()]);
  assert.doesNotMatch(dump, /10\.0\.0\.|phone/);
});

test("the sums need a sign-in; hits are limited per address", async () => {
  assert.equal((await fetch(base + "/api/visits")).status, 401);
  let last = 0; for (let i = 0; i < 35; i++) last = (await hit("/", "10.9.9.9")).status;
  assert.equal(last, 429);
});

test.after(() => server.close());
