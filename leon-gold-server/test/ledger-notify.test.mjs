// Push notifications for «حساب من»: a party turns them on; a new showcase piece, its order's next step, or work given to it
// reaches its devices, encrypted (aes128gcm) and signed (VAPID). A local stand-in plays the browser's push service.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-lnotify-"));
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


// ---------- the ledger's own users («دفتر لئون») ----------
test("each ledger user hears of the others' saves in the sections it may open, never its own; a new «حساب من» order reaches all who see orders", async () => {
  await sync([{ c: "settings", id: "lock", d: { users: [{ u: "علی", hash: "x", salt: "s" }, { u: "شاگرد", hash: "y", salt: "t", perms: ["invoices", "orders"] }, { u: "انباردار", hash: "z", salt: "u", perms: ["products"] }] } }]);
  assert.equal((await call("/api/notify/sub", { ...device("x"), u: "علی" })).status, 401);
  assert.equal((await call("/api/notify/sub", { ...device("x"), endpoint: "http://10.0.0.5/steal", u: "علی" }, owner)).error, "bad_sub");
  for (const [d, u] of [["ali", "علی"], ["sh", "شاگرد"], ["anb", "انباردار"]]) assert.equal((await call("/api/notify/sub", { ...device(d), u }, owner)).ok, true);
  got.length = 0;
  const t = await call("/api/notify/test", { endpoint: `http://127.0.0.1:${svc.address().port}/sh` }, owner);
  assert.equal(t.ok, true); assert.match(got[0].msg.body, /روشن است/);

  got.length = 0;
  await sync([{ c: "invoices", id: "i1", d: { kind: "retail", no: 12, partyName: "مشتری" } }, { c: "log", id: "g1", d: { op: "save", col: "invoices", docId: "i1", by: "شاگرد" } }]);
  await wait();
  const to = dev => got.filter(g => g.dev === dev).map(g => g.msg);
  assert.equal(to("/sh").length, 0, "not to the one who made it");
  assert.equal(to("/anb").length, 0, "not to a user without «فاکتورها»");
  assert.equal(to("/ali")[0].title, "دفتر لئون · ثبت تازه");
  assert.equal(to("/ali")[0].body, "فاکتور خرده ۱۲ · مشتری — شاگرد");
  assert.match(to("/ali")[0].url, /^https:\/\/leongold\.net\/daftar\/$/);

  got.length = 0;
  await sync([{ c: "invoices", id: "i1", d: null }, { c: "log", id: "g2", d: { op: "delete", col: "invoices", docId: "i1", by: "علی" } }]);
  await wait();
  assert.deepEqual(got.map(g => g.dev), ["/sh"]);
  assert.equal(got[0].msg.title, "دفتر لئون · حذف شد");

  got.length = 0;
  await sync([{ c: "crm_leads", id: "l1", d: { name: "مشتری", what: "انگشتر (۱۰۲)", status: "new" } }]);
  await wait();
  assert.deepEqual(got.map(g => g.dev).sort(), ["/ali", "/sh"]);
  assert.equal(got[0].msg.title, "سفارش تازه از «حساب من»");
  got.length = 0;
  await sync([{ c: "crm_leads", id: "l1", d: { name: "مشتری", what: "انگشتر (۱۰۲)", status: "talking" } }]); // its status moving is not news
  await wait();
  assert.equal(got.length, 0);
  // an order from the site's own form (owner, 2026-11-14): its own title, with the visitor's phone number
  await sync([{ c: "crm_leads", id: "l2", d: { name: "سارا", phone: "09121234567", what: "انگشتر", source: "سایت", status: "new" } }]);
  await wait();
  assert.deepEqual(got.map(g => g.dev).sort(), ["/ali", "/sh"]);
  assert.equal(got[0].msg.title, "سفارش تازه از سایت");
  assert.equal(got[0].msg.body, "سارا · ۰۹۱۲۱۲۳۴۵۶۷ · انگشتر");
});

test("a burst becomes one message; a user who signs in on the device takes its notifications over", async () => {
  got.length = 0;
  const ch = [];
  for (let i = 0; i < 9; i++) ch.push({ c: "products", id: "p" + i, d: { name: "کالا " + i } });
  await sync(ch);
  await wait();
  const anb = got.filter(g => g.dev === "/anb");
  assert.equal(anb.length, 1);
  assert.match(anb[0].msg.title, /۹ خبر تازه/);
  assert.match(anb[0].msg.body, /۳ مورد دیگر/);
  // «شاگرد» signs in on the phone that was «انباردار»'s
  await call("/api/notify/sub", { ...device("anb"), u: "شاگرد" }, owner);
  got.length = 0;
  await sync([{ c: "products", id: "p9", d: { name: "کالا ۹" } }]);
  await wait();
  assert.equal(got.filter(g => g.dev === "/anb").length, 0);
  server.close(); svc.close();
});
