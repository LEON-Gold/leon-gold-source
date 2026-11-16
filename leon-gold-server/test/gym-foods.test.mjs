// «روتین من» «غذاها»: views and "I cooked it" are counted once per person per day, shared by everyone, and can be undone.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-gym-foods-"));
const { server } = await import("../server.mjs");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, { method = "GET", body, token } = {}) => {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json()) };
};
const login = async (u, p) => (await call("/api/gym/login", { method: "POST", body: { u, p } })).token;
const mark = (t, id, kind, undo) => call("/api/gym/foods/mark", { method: "POST", token: t, body: { id, kind, undo } });

test("views and cooks: once per person per day, shared, undoable; bad input refused", async () => {
  const leon = await login("leon", "138413");
  await call("/api/gym/users/add", { method: "POST", token: leon, body: { u: "sara", p: "gol1234" } });
  const sara = await login("sara", "gol1234");
  assert.equal((await call("/api/gym/foods/stats")).status, 401);
  assert.equal((await mark(leon, "Bad Id!", "view")).status, 400);
  assert.equal((await mark(leon, "joojeh", "like")).status, 400);
  await mark(leon, "joojeh", "view"); await mark(leon, "joojeh", "view"); await mark(sara, "joojeh", "view");
  await mark(leon, "joojeh", "cook"); await mark(leon, "joojeh", "cook"); await mark(sara, "adasi", "cook");
  let s = await call("/api/gym/foods/stats", { token: leon });
  assert.deepEqual(s.foods.joojeh, { views: 2, cooks: 1, myCooks: 1 });
  assert.deepEqual(s.foods.adasi, { views: 0, cooks: 1, myCooks: 0 });
  assert.deepEqual(s.cookedToday, ["joojeh"]);
  await mark(leon, "joojeh", "cook", true);
  s = await call("/api/gym/foods/stats", { token: leon });
  assert.equal(s.foods.joojeh.cooks, 0); assert.deepEqual(s.cookedToday, []);
  // a removed user's marks go with them
  await call("/api/gym/users/remove", { method: "POST", token: leon, body: { u: "sara" } });
  s = await call("/api/gym/foods/stats", { token: leon });
  assert.equal(s.foods.joojeh.views, 1); assert.equal(s.foods.adasi, undefined);
});

test("food photos are served from gym/img as JPEG; nothing outside gym/ can be reached", async () => {
  const dir = path.join(import.meta.dirname, "..", "gym", "img"), f = path.join(dir, "zz-test.jpg"), made = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  try {
    const r = await fetch(base + "/gym/img/zz-test.jpg");
    assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/jpeg");
    assert.notEqual((await fetch(base + "/gym/img/nope.jpg")).status, 200);
    // raw paths (fetch would tidy the dots away)
    const raw = p => new Promise(ok => import("node:http").then(http => http.get({ host: "127.0.0.1", port: server.address().port, path: p }, res => { res.resume(); ok(res.statusCode); })));
    for (const p of ["/gym/img/../../gym.mjs", "/gym/..%2Fgym.mjs", "/gym/../server.mjs"]) assert.notEqual(await raw(p), 200, p);
  } finally { fs.rmSync(f); if (made) fs.rmdirSync(dir); }
});

test.after(() => server.close());
