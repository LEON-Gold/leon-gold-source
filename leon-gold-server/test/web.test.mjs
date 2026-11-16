// The public site on leongold.net (owner, 2026-11-14): this server answers the domain with web/ (the site's static
// export), keeps the API on every host, never serves a file outside web/, and api.leongold.net stays JSON only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-web-"));
const { server } = await import("../server.mjs");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
import http from "node:http";
// fetch() will not send another Host, so a plain request: answers like fetch's (status, headers.get, text, json, arrayBuffer)
const get = (p, host, h = {}) => new Promise((ok, no) => {
  const q = http.request(base + "/", { path: p, headers: { Host: host, ...h } }, r => {
    const c = []; r.on("data", d => c.push(d)); r.on("end", () => { const buf = Buffer.concat(c);
      ok({ status: r.statusCode, headers: { get: k => r.headers[k.toLowerCase()] ?? null }, text: async () => buf.toString("utf8"), json: async () => JSON.parse(buf.toString("utf8")), arrayBuffer: async () => buf }); });
  });
  q.on("error", no); q.end();
});
const has = fs.existsSync(new URL("../web/index.html", import.meta.url));

test("leongold.net: the site's pages, with page headers that let it run and frame the ledger", { skip: !has && "no web/ build" }, async () => {
  const r = await get("/", "leongold.net");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.match(await r.text(), /لئون گلد/);
  assert.equal(r.headers.get("x-robots-tag"), null);   // the public pages may be indexed
  // the private ones never: the ledger, «حساب من» and the panel
  for (const p of ["/hesab/", "/daftar/", "/panel/"]) { const q = await get(p, "leongold.net"); assert.equal(q.status, 200); assert.equal(q.headers.get("x-robots-tag"), "noindex, nofollow, noarchive"); }
  const nf = await get("/no-such-page/", "leongold.net");
  assert.equal(nf.status, 404); assert.match(nf.headers.get("content-type"), /text\/html/);
});

test("folders get their slash, www goes to the bare domain", { skip: !has && "no web/ build" }, async () => {
  const a = await get("/hesab?t=orders", "leongold.net");
  assert.equal(a.status, 301); assert.equal(a.headers.get("location"), "/hesab/?t=orders");
  const w = await get("/kids/", "www.leongold.net");
  assert.equal(w.status, 301); assert.equal(w.headers.get("location"), "https://leongold.net/kids/");
});

test("nothing outside web/ is served", { skip: !has && "no web/ build" }, async () => {
  for (const p of ["/../server.mjs", "/%2e%2e/server.mjs", "/..%2fserver.mjs", "/%2e%2e%2fdata/leon.db"]) {
    const r = await get(p, "leongold.net");
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(await r.text(), /createServer|SQLite/, p);
  }
});

test("the API stays the API on the domain, and api.leongold.net is unchanged", async () => {
  const h = await get("/api/health", "leongold.net");
  assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true });
  const api = await get("/", "api.leongold.net");
  assert.equal(api.status, 302);
  assert.equal(api.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
  const nopage = await get("/hesab/", "api.leongold.net");
  assert.notEqual(nopage.status, 200);
});

test("the museum film plays in Safari: byte ranges", { skip: !has && "no web/ build" }, async () => {
  const f = fs.readdirSync(new URL("../web/museum/", import.meta.url)).find(x => x.endsWith(".webm") || x.endsWith(".mp4"));
  if (!f) return;
  const r = await get("/museum/" + f, "leongold.net", { Range: "bytes=0-99" });
  assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 100);
});

test.after(() => server.close());

test("the apps download from the domain: apps/ beside web/, plain names only", async () => {
  const has = fs.existsSync(new URL("../apps/leon-gold.apk", import.meta.url));
  if (has) {
    const r = await get("/apps/leon-gold.apk", "leongold.net");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/vnd.android.package-archive");
    assert.match(r.headers.get("content-disposition"), /attachment; filename="leon-gold.apk"/);
    assert.equal((await r.arrayBuffer()).byteLength, fs.statSync(new URL("../apps/leon-gold.apk", import.meta.url)).size);
  }
  for (const p of ["/apps/../server.mjs", "/apps/server.mjs", "/apps/x.apk", "/apps/.hidden.apk", "/apps/sub/leon-gold.apk"]) {
    const r = await get(p, "leongold.net");
    assert.notEqual(r.status, 200, p);
  }
  assert.notEqual((await get("/apps/leon-gold.apk", "api.leongold.net")).status, 200);
});
