// «روتین من» reminders (gym.mjs): a phone subscribes, the page hands over the coming schedule, and each reminder reaches
// that user's phones (only theirs) at its time, encrypted and signed. A local stand-in plays the browser's push service.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-gym-push-"));
process.env.PUSH_TEST_HOST = "127.0.0.1";
process.env.GYM_PUSH_TICK_MS = "100";
const { server } = await import("../server.mjs");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, { method = "GET", body, token } = {}) => {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const login = async (u, p) => (await call("/api/gym/login", { method: "POST", body: { u, p } })).token;

// the phone's side: its key pair and auth secret, and a push service that decrypts what it gets (RFC 8291)
const got = [], devices = new Map();
const svc = http.createServer((req, res) => {
  const parts = []; req.on("data", c => parts.push(c)); req.on("end", () => {
    const dev = devices.get(req.url), body = Buffer.concat(parts);
    if (!dev) { res.writeHead(410); return res.end(); }
    const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
    const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
    const shared = dev.ecdh.computeSecret(as), ua = dev.ecdh.getPublicKey();
    const ikm = hmac(hmac(dev.auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ua, as, Buffer.from([1])])), prk = hmac(salt, ikm);
    const d = crypto.createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    got.push({ dev: req.url, auth: req.headers.authorization, msg: JSON.parse(plain.subarray(0, plain.length - 1).toString()) });
    res.writeHead(201); res.end();
  });
});
await new Promise(r => svc.listen(0, "127.0.0.1", r));
const device = name => { const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys(); const auth = crypto.randomBytes(16); devices.set("/" + name, { ecdh, auth });
  return { endpoint: `http://127.0.0.1:${svc.address().port}/${name}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }; };

test("a phone turns reminders on; made-up push addresses are refused; the test message arrives signed and encrypted", async () => {
  const t = await login("leon", "138413");
  assert.equal(Buffer.from((await call("/api/gym/push/key", { token: t })).key, "base64url").length, 65);
  assert.equal((await call("/api/gym/push/sub", { method: "POST", body: device("x") })).status, 401);
  assert.equal((await call("/api/gym/push/sub", { method: "POST", token: t, body: { ...device("x"), endpoint: "http://10.0.0.5/steal" } })).error, "bad_sub");
  assert.equal((await call("/api/gym/push/test", { method: "POST", token: t })).error, "no_sub");
  assert.equal((await call("/api/gym/push/sub", { method: "POST", token: t, body: device("leon-phone") })).ok, true);
  const r = await call("/api/gym/push/test", { method: "POST", token: t });
  assert.equal(r.ok, true); assert.equal(r.sent, 1);
  assert.equal(got.at(-1).dev, "/leon-phone"); assert.match(got.at(-1).auth, /^vapid t=.+, k=/); assert.equal(got.at(-1).msg.url, "/gym/");
});

test("the schedule: each reminder reaches only its own user's phones at its time; a new schedule replaces the old", async () => {
  const admin = await login("leon", "138413");
  await call("/api/gym/users/add", { method: "POST", token: admin, body: { u: "sara", p: "gol1234" } });
  const sara = await login("sara", "gol1234");
  await call("/api/gym/push/sub", { method: "POST", token: sara, body: device("sara-phone") });
  got.length = 0;
  const now = Date.now();
  let r = await call("/api/gym/push/plan", { method: "PUT", token: admin, body: { items: [
    { at: now + 300, tag: "d:bf", title: "۷:۰۰ · صبحانه", body: "منوها: املت" },
    { at: now + 60e3, tag: "d:lunch", title: "ناهار", body: "" },
    { at: now - 3600e3, tag: "old", title: "گذشته", body: "" }, // already past: dropped
    { at: now + 400, tag: "x", title: "", body: "بدون عنوان" } // no title: dropped
  ] } });
  assert.equal(r.n, 2); assert.equal(r.subs, 1);
  await call("/api/gym/push/plan", { method: "PUT", token: sara, body: { items: [{ at: now + 300, tag: "d:gym", title: "باشگاه", body: "" }] } });
  await sleep(900);
  assert.deepEqual(got.map(g => [g.dev, g.msg.title]).sort(), [["/leon-phone", "۷:۰۰ · صبحانه"], ["/sara-phone", "باشگاه"]]);
  assert.equal(got.find(g => g.dev === "/leon-phone").msg.body, "منوها: املت");
  // a new schedule replaces the old one: the lunch reminder is gone
  r = await call("/api/gym/push/plan", { method: "PUT", token: admin, body: { items: [] } });
  assert.equal(r.n, 0);
  assert.equal((await call("/api/gym/push/plan", { method: "PUT", token: admin, body: { items: "x" } })).status, 400);
});

test("a phone that turns them off, a dropped subscription and a removed user get nothing more", async () => {
  const admin = await login("leon", "138413"), sara = await login("sara", "gol1234");
  await call("/api/gym/push/unsub", { method: "POST", token: admin, body: { endpoint: device("leon-phone").endpoint } });
  assert.equal((await call("/api/gym/push/test", { method: "POST", token: admin })).error, "no_sub");
  devices.delete("/sara-phone"); // the browser dropped it: the push service answers 410 and the server forgets it
  await call("/api/gym/push/test", { method: "POST", token: sara });
  assert.equal((await call("/api/gym/push/test", { method: "POST", token: sara })).error, "no_sub");
  await call("/api/gym/push/sub", { method: "POST", token: sara, body: device("sara-2") });
  await call("/api/gym/push/plan", { method: "PUT", token: sara, body: { items: [{ at: Date.now() + 500, tag: "a", title: "شام", body: "" }] } });
  await call("/api/gym/users/remove", { method: "POST", token: admin, body: { u: "sara" } });
  got.length = 0; await sleep(800);
  assert.equal(got.length, 0);
  // the page's service worker is served fresh each time
  const sw = await fetch(base + "/gym/sw.js");
  assert.equal(sw.status, 200); assert.equal(sw.headers.get("cache-control"), "no-cache");
});

test.after(() => { server.close(); svc.close(); });
