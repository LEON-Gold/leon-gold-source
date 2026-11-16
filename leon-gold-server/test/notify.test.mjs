// Push notifications for «حساب من»: a party turns them on; a new showcase piece, its order's next step, or work given to it
// reaches its devices, encrypted (aes128gcm) and signed (VAPID). A local stand-in plays the browser's push service.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-notify-"));
process.env.PUSH_TEST_HOST = "127.0.0.1";
process.env.PUSH_DELAY_MS = "60";
const { server, setUser } = await import("../server.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
const sync = changes => call("/api/push", { changes }, owner);
await sync([
  { c: "parties", id: "c1", d: { name: "مشتری", kind: "customer" } },
  { c: "parties", id: "c2", d: { name: "مشتری دوم", kind: "customer" } },
  { c: "parties", id: "w1", d: { name: "کارگاه", kind: "customer" } }, // marked a customer, picked as a maker
]);
const enter = async id => (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: id }, owner)).k })).token;

// the browser's side: its own key pair and auth secret, and a push service that decrypts what it is sent (RFC 8291)
const got = [];
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
    got.push({ dev: req.url, auth: req.headers.authorization, enc: req.headers["content-encoding"], msg: JSON.parse(plain.subarray(0, plain.length - 1).toString()) });
    res.writeHead(201); res.end();
  });
});
await new Promise(r => svc.listen(0, "127.0.0.1", r));
const devices = new Map();
const device = name => { const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys(); const auth = crypto.randomBytes(16); devices.set("/" + name, { ecdh, auth });
  return { endpoint: `http://127.0.0.1:${svc.address().port}/${name}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }; };
const wait = async () => { await sleep(250); };

test("a party turns notifications on; made-up push addresses are refused; the test message arrives, signed and encrypted", async () => {
  const key = await call("/api/portal/push/key");
  assert.equal(Buffer.from(key.key, "base64url").length, 65);
  const t = await enter("c1");
  assert.equal((await call("/api/portal/push/sub", device("x"))).status, 401);
  assert.equal((await call("/api/portal/push/sub", { ...device("x"), endpoint: "http://10.0.0.5/steal" }, t)).error, "bad_sub");
  assert.equal((await call("/api/portal/push/sub", device("c1-phone"), t)).ok, true);
  got.length = 0;
  const tr = await call("/api/portal/push/test", {}, t);
  assert.equal(tr.ok, true);
  assert.equal(tr.results[0].status, 201);
  assert.equal(got.length, 1);
  assert.equal(got[0].enc, "aes128gcm");
  assert.match(got[0].auth, new RegExp("^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=" + key.key + "$"));
  assert.match(got[0].msg.body, /روشن است/);
});

test("a new piece on show reaches every subscribed party, a burst as one message", async () => {
  await call("/api/portal/push/sub", device("c2-phone"), await enter("c2"));
  got.length = 0;
  await sync([{ c: "vitrin", id: "v1", d: { name: "انگشتر سولیتر", show: true } }, { c: "vitrin", id: "v2", d: { name: "گوشواره", show: true } }, { c: "vitrin", id: "v3", d: { name: "پنهان", show: false } }]);
  await wait();
  assert.equal(got.length, 2);
  for (const g of got) { assert.match(g.msg.body, /۲ خبر تازه/); assert.match(g.msg.body, /انگشتر سولیتر/); assert.ok(!/پنهان/.test(g.msg.body)); assert.match(g.msg.url, /hesab\/\?t=vitrin$/); }
  got.length = 0;
  await sync([{ c: "vitrin", id: "v1", d: { name: "انگشتر سولیتر", show: true, qty: 2 } }]); // an edit is not news
  await wait();
  assert.equal(got.length, 0);
});

test("a customer hears of its own order and its next step; the maker (whatever its kind) of work given to it, and a new due date", async () => {
  await call("/api/portal/push/sub", device("w1-phone"), await enter("w1"));
  got.length = 0;
  const order = { partyId: "c1", status: "new", due: "۱۴۰۵/۰۹/۰۱", items: [{ desc: "دستبند", supId: "w1" }] };
  await sync([{ c: "orders", id: "o1", d: order }]);
  await wait();
  const by = dev => got.filter(g => g.dev === dev).map(g => g.msg);
  assert.equal(by("/c1-phone")[0].title, "سفارش شما ثبت شد");
  assert.equal(by("/w1-phone")[0].title, "کار تازه به شما سپرده شد");
  assert.match(by("/w1-phone")[0].body, /دستبند · موعد/);
  assert.equal(by("/c2-phone").length, 0);
  got.length = 0;
  await sync([{ c: "orders", id: "o1", d: { ...order, status: "ready", due: "۱۴۰۵/۰۹/۰۵" } }]);
  await wait();
  assert.equal(by("/c1-phone")[0].title, "سفارش شما: آماده‌ی تحویل");
  assert.equal(by("/w1-phone")[0].title, "موعد کار تغییر کرد");
});

test("a piece shown only to some parties is news only to them, and to whoever is added to it later", async () => {
  got.length = 0;
  await sync([{ c: "vitrin", id: "vp", d: { name: "سرویس ویژه", show: true, to: ["c1"] } }]);
  await wait();
  assert.deepEqual(got.map(g => g.dev).sort(), ["/c1-phone"]);
  got.length = 0;
  await sync([{ c: "vitrin", id: "vp", d: { name: "سرویس ویژه", show: true, to: ["c1", "w1"] } }]);
  await wait();
  assert.deepEqual(got.map(g => g.dev).sort(), ["/w1-phone"]);
});

test("a dropped subscription is forgotten; a party signed out everywhere gets nothing more", async () => {
  devices.delete("/c2-phone"); // its browser dropped it: the push service answers 410
  await sync([{ c: "vitrin", id: "v9", d: { name: "پلاک", show: true } }]);
  await wait();
  got.length = 0;
  await sync([{ c: "vitrin", id: "v10", d: { name: "زنجیر", show: true } }]);
  await wait();
  assert.equal(got.filter(g => g.dev === "/c2-phone").length, 0);
  await call("/api/portal/revoke", { partyId: "c1" }, owner);
  got.length = 0;
  await sync([{ c: "orders", id: "o2", d: { partyId: "c1", status: "new", items: [{ desc: "پلاک" }] } }]);
  await wait();
  assert.equal(got.filter(g => g.dev === "/c1-phone").length, 0);
  server.close(); svc.close();
});
