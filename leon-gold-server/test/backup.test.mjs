// Off-site backup and restore, end to end on throwaway data: download a copy, check it holds no logins,
// change the server, restore the copy, and get the same documents and photos back.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-bk-"));
const { server, setUser } = await import("../server.mjs");
const { pull, check, restore } = await import("../tools/backup.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const auth = (await (await fetch(base + "/api/login", { method: "POST", body: JSON.stringify({ u: "owner", p: "1234" }) })).json()).token;
const push = changes => fetch(base + "/api/push", { method: "POST", headers: { Authorization: "Bearer " + auth }, body: JSON.stringify({ changes }) });
const live = async () => Object.fromEntries((await (await fetch(base + "/api/pull?since=0", { headers: { Authorization: "Bearer " + auth } })).json()).changes.filter(ch => ch.d != null).map(ch => [ch.c + "/" + ch.id, ch.d]));
const photo = new Uint8Array([9, 8, 7, 255]);

test("only a signed-in owner gets a copy", async () => {
  assert.equal((await fetch(base + "/api/backup")).status, 401);
});

test("backup, change, restore: everything comes back", async () => {
  await push([{ c: "parties", id: "p1", d: { name: "مشتری", phone: "09120000000" } }, { c: "invoices", id: "i1", d: { partyId: "p1", deltaR: 5 } }, { c: "settlements", id: "gone", d: null }]);
  await fetch(base + "/api/blob/ph1", { method: "PUT", headers: { Authorization: "Bearer " + auth, "Content-Type": "image/png" }, body: photo });
  // a party's own password, so the check below proves its hash stays out of the copy
  await fetch(base + "/api/portal/login/set", { method: "POST", headers: { Authorization: "Bearer " + auth }, body: JSON.stringify({ partyId: "p1", username: "moshtari", password: "secret1" }) });
  const before = await live();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leon-bk-out-")), got = await pull({ server: base, dir, auth });
  assert.deepEqual(got.docs, { invoices: 1, parties: 1 });
  assert.equal(got.photos, 1);
  // the copy opens no device: no logins (the ledger's or a party's), sessions or links in it
  const c = new DatabaseSync(got.file, { readOnly: true });
  for (const t of ["users", "sessions", "portal_sessions", "portal_logins", "portal_invites"]) assert.equal(c.prepare(`SELECT count(*) AS n FROM ${t}`).get().n, 0, t);
  c.close();
  const temps = () => fs.readdirSync(path.join(process.env.DATA_DIR, "backups")).filter(n => n.startsWith("tmp-"));
  for (let i = 0; i < 50 && temps().length; i++) await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(temps(), [], "temp copy removed");

  await push([{ c: "parties", id: "p1", d: { name: "خراب" } }, { c: "invoices", id: "i1", d: null }, { c: "parties", id: "extra", d: { name: "بعدا" } }]);
  assert.deepEqual(await restore(got.file, { server: base, auth }), { written: 2, deleted: 1, photos: 1 });
  assert.deepEqual(await live(), before);
  const b = await fetch(base + "/api/blob/ph1", { headers: { Authorization: "Bearer " + auth } });
  assert.deepEqual(new Uint8Array(await b.arrayBuffer()), photo);
});

test("a damaged file is refused", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "leon-bk-bad-")), "x.db");
  fs.writeFileSync(f, "not a database");
  assert.throws(() => check(f));
});

test("photos are served as pictures only, never as pages", async () => {
  await fetch(base + "/api/blob/evil", { method: "PUT", headers: { Authorization: "Bearer " + auth, "Content-Type": "text/html" }, body: "<script>alert(1)</script>" });
  const r = await fetch(base + "/api/blob/evil", { headers: { Authorization: "Bearer " + auth } });
  assert.equal(r.headers.get("content-type"), "application/octet-stream");
  assert.match(r.headers.get("content-security-policy"), /sandbox/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  server.close();
});
