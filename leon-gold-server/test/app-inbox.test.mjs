// The Android app's inbox: a device registers with the party's «حساب من» session; the party's messages are kept for it
// and the app fetches what came after the last one it showed. Parties without an app device keep nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-inbox-"));
process.env.PUSH_DELAY_MS = "40";
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
await sync([{ c: "parties", id: "c1", d: { name: "مشتری", kind: "customer" } }, { c: "parties", id: "c2", d: { name: "دوم", kind: "customer" } }]);
const enter = async id => (await call("/api/portal/redeem", { k: (await call("/api/portal/invite", { partyId: id }, owner)).k })).token;

test("app device: register needs a session and a sane id; messages land in its inbox in order; others see nothing", async () => {
  const t1 = await enter("c1"), t2 = await enter("c2");
  assert.equal((await call("/api/portal/push/app", { dev: "a".repeat(20) })).status, 401);
  assert.equal((await call("/api/portal/push/app", { dev: "../x" }, t1)).error, "bad_dev");
  const reg = await call("/api/portal/push/app", { dev: "dev-one-1234567890" }, t1);
  assert.equal(reg.ok, true); assert.equal(reg.last, 0);
  await sync([{ c: "vitrin", id: "v1", d: { name: "انگشتر", show: true } }]);
  await sync([{ c: "orders", id: "o1", d: { partyId: "c1", status: "new", items: [{ desc: "گردنبند" }] } }]);
  await sleep(150);
  const box = await call("/api/portal/push/inbox?after=0", null, t1);
  assert.equal(box.items.length, 1, "a burst is one message");
  assert.match(box.items[0].body, /انگشتر/); assert.match(box.items[0].body, /گردنبند/);
  assert.equal(box.last, box.items[0].id);
  assert.equal((await call("/api/portal/push/inbox?after=" + box.last, null, t1)).items.length, 0);
  assert.equal((await call("/api/portal/push/inbox?after=0", null, t2)).items.length, 0, "c2 has no app device");
  assert.equal((await call("/api/portal/push/inbox?after=0")).status, 401);
});

test("turning the app off and signing out stop it", async () => {
  const t1 = await enter("c1");
  await call("/api/portal/push/app", { dev: "dev-one-1234567890" }, t1);
  assert.equal((await call("/api/portal/push/app/off", { dev: "dev-one-1234567890" }, t1)).ok, true);
  await sync([{ c: "vitrin", id: "v2", d: { name: "دستبند", show: true } }]);
  await sleep(150);
  const box = await call("/api/portal/push/inbox?after=0", null, t1);
  assert.ok(!box.items.some(i => /دستبند/.test(i.body)), "no device, nothing kept");
});

test.after(() => server.close());
