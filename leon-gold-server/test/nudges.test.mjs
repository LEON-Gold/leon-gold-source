// «حساب من» reminders (owner, 2026-11-14): a party whose password the owner made is asked to set its own, one whose details
// are not complete to fill them in: on its home page (passNew), and on its phone at most once a week each while not done.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-nudges-"));
const { server, setUser, db } = await import("../server.mjs");
const { nudges } = await import("../portal.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
await call("/api/push", { changes: [{ c: "parties", id: "n1", d: { name: "آقای نوری", kind: "customer" } }, { c: "parties", id: "n2", d: { name: "خانم رادان", kind: "customer" } }] }, owner);
await call("/api/portal/login/set", { partyId: "n1", username: "noori", password: "Gold1405" }, owner);
const tok = async (u, p) => (await call("/api/portal/login", { u, p })).token;
// a device with notifications on (the push subscription itself is tested in notify.test.mjs)
const sub = id => db.prepare("INSERT INTO push_subs (who, endpoint, p256dh, auth, created) VALUES (?, ?, 'k', 'a', ?)").run("party:" + id, "https://web.push.apple.com/" + id, Date.now());

test("a password the owner made: «حساب من» asks for one's own until it is changed", async () => {
  const t = await tok("noori", "Gold1405");
  assert.equal((await call("/api/portal/me", null, t)).passNew, true);
  await call("/api/portal/password", { old: "Gold1405", new: "Mine2026" }, t);
  assert.equal((await call("/api/portal/me", null, t)).passNew, undefined);
  // the owner sets a new one in the ledger: asked again
  await call("/api/portal/login/set", { partyId: "n1", username: "noori", password: "Reset123" }, owner);
  assert.equal((await call("/api/portal/me", null, await tok("noori", "Reset123"))).passNew, true);
});

test("a login from before the column: its own when a sign-up made it, else the owner's", async () => {
  db.prepare("UPDATE portal_logins SET own = NULL WHERE party = 'n1'").run();
  assert.equal((await call("/api/portal/me", null, await tok("noori", "Reset123"))).passNew, true, "no sign-up behind it");
  const row = db.prepare("SELECT * FROM portal_logins WHERE party = 'n1'").get();
  db.prepare("INSERT INTO portal_signups (id, name, salt, hash, data, created, status) VALUES ('sg1', 'noori', ?, ?, '{}', ?, 'done')").run(row.salt, row.hash, Date.now());
  assert.equal((await call("/api/portal/me", null, await tok("noori", "Reset123"))).passNew, undefined, "its own sign-up");
  db.prepare("UPDATE portal_logins SET own = 0 WHERE party = 'n1'").run();
});

test("the phone: each reminder once a week while not done, only to parties with notifications on", async () => {
  const got = [], tell = (id, m) => got.push([id, m.title, m.body, m.tab]);
  const t0 = Date.parse("2026-11-14T08:00:00Z");
  assert.equal(nudges(db, tell, t0), 0, "nobody has notifications on yet");
  sub("n1"); sub("n2");
  nudges(db, tell, t0);
  assert.deepEqual(got.map(g => g[0] + ":" + g[1]), ["n1:رمز خودتان را بگذارید", "n1:اطلاعات «حساب من» را کامل کنید"], "n2 has no login");
  assert.equal(got[1][2], "هنوز ثبت نشده: نام و نام خانوادگی، موبایل، کد ملی، تاریخ تولد، کد پستی، نشانی"); assert.equal(got[0][3], "profile");
  got.length = 0;
  nudges(db, tell, t0 + 3 * 864e5); assert.equal(got.length, 0, "not again within the week");
  // it fills in some details and sets its own password: a week later only what is still missing
  const t = await tok("noori", "Reset123");
  await call("/api/portal/password", { old: "Reset123", new: "Mine2027" }, t);
  await call("/api/portal/info", { fullName: "علی نوری", mobile: "09121112233", nationalId: "0084575948" }, t);
  nudges(db, tell, t0 + 8 * 864e5);
  assert.deepEqual(got.map(g => g[1] + " · " + g[2]), ["اطلاعات «حساب من» را کامل کنید · هنوز ثبت نشده: تاریخ تولد، کد پستی، نشانی"]);
  got.length = 0;
  await call("/api/portal/info", { fullName: "علی نوری", mobile: "09121112233", nationalId: "0084575948", birth: "1365/02/02", postal: "1234567890", address: "تهران" }, t);
  nudges(db, tell, t0 + 20 * 864e5); assert.equal(got.length, 0, "all done: nothing");
  // a party the owner switched off gets nothing
  await call("/api/portal/login/set", { partyId: "n1", username: "noori", password: "Reset999" }, owner);
  await call("/api/push", { changes: [{ c: "parties", id: "n1", d: { name: "آقای نوری", kind: "customer", portalOff: true } }] }, owner);
  nudges(db, tell, t0 + 40 * 864e5); assert.equal(got.length, 0);
});

test.after(() => server.close());
