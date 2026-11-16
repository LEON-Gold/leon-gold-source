// The showcase's «گروه»‌ها and «کتگوری»‌ها (owner, 2026-11-13): groups are «نوع کار» tags with group:true (لیزری، ریخته،
// پایه جواهر، بچگانه by default; a list saved before groups existed is read with them added, nothing stored is rewritten);
// categories are the owner's list in settings/vcats (default: the site's old fixed list). A supplier that may upload picks
// groups and a category, or proposes a new category: it waits (settings/vcq_*) and only its maker sees it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vcats-"));
const { server, setUser } = await import("../server.mjs");
const { normTags, catKey } = await import("../portal.mjs");
setUser("owner", "1234");
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (p, body, token) => {
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const owner = (await call("/api/login", { u: "owner", p: "1234" })).token;
const sync = changes => call("/api/push", { changes }, owner);
const pull = async () => (await call("/api/pull?since=0", null, owner)).changes;
const last = async (c, id) => (await pull()).filter(x => x.c === c && x.id === id).pop();
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

await sync([
  { c: "parties", id: "sup1", d: { name: "کارگاه یک", kind: "supplier", upload: true } },
  { c: "parties", id: "sup2", d: { name: "کارگاه دو", kind: "supplier", upload: true } },
  { c: "parties", id: "cus1", d: { name: "مشتری", kind: "customer" } },
  { c: "vitrin", id: "p1", d: { name: "گردنبند لیزری", cat: "گردنبند", tags: ["laser", "kids"], site: true, show: true, weight: 3, media: [], ts: "2026-11-01T00:00:00Z" } },
]);
for (const [partyId, username] of [["sup1", "sup.one"], ["sup2", "sup.two"], ["cus1", "cus.one"]]) await call("/api/portal/login/set", { partyId, username, password: "Gold1405" }, owner);
const tok = async u => (await call("/api/portal/login", { u, p: "Gold1405" })).token;

test("groups: the default list, and an old saved list gets the default groups without being rewritten", async () => {
  const d = normTags(null);
  assert.deepEqual(d.filter(x => x.group).map(x => x.k), ["laser", "cast", "jewel", "kids"]);
  assert.ok(!d.find(x => x.k === "lux").group, "لوکس stays a filter, not a group");
  const old = [{ k: "lux", name: "لوکس" }, { k: "laser", name: "لیزری" }, { k: "t9", name: "سبک" }];
  const n = normTags(old);
  assert.deepEqual(n.filter(x => x.group).map(x => x.k), ["laser", "cast", "jewel", "kids"]);
  assert.equal(n.find(x => x.k === "t9").group, undefined);
  // once the owner has set any group flag, the list is taken as it is
  const own = normTags([{ k: "laser", name: "لیزری", group: true }, { k: "cast", name: "ریخته", group: false }]);
  assert.deepEqual(own.filter(x => x.group).map(x => x.k), ["laser"]);
  const pub = await call("/api/public/vitrin");
  assert.deepEqual(pub.groups.map(g => g.name), ["لیزری", "ریخته", "پایه جواهر", "بچگانه"]);
  assert.deepEqual(pub.items[0].tags, ["لیزری", "بچگانه"], "a piece may be in several groups");
  // nothing was written to settings/vtags
  assert.equal(await last("settings", "vtags"), undefined);
});

test("categories: the default list until the owner saves one; renamed ones keep their old names", async () => {
  let pub = await call("/api/public/vitrin");
  assert.equal(pub.cats[0].name, "انگشتر"); assert.equal(pub.cats.length, 11);
  await sync([{ c: "settings", id: "vcats", d: { cats: [{ k: "ring", name: "انگشترها", alias: ["انگشتر"] }, { k: "c1", name: "ست عروس" }] } }]);
  pub = await call("/api/public/vitrin");
  assert.deepEqual(pub.cats, [{ k: "ring", name: "انگشترها", alias: ["انگشتر"] }, { k: "c1", name: "ست عروس" }]);
  const t = await tok("cus.one"), v = await call("/api/portal/vitrin", null, t);
  assert.equal(v.cats.length, 2); assert.ok(Array.isArray(v.groups)); assert.equal(v.myCats, undefined);
  assert.equal(catKey("نیم ‌ست"), catKey("نیم‌ست")); assert.equal(catKey("گوشواره ي"), catKey("گوشوارهی"));
  await sync([{ c: "settings", id: "vcats", d: null }]);
});

test("a supplier proposes a category: it waits, only its maker sees it, an existing name is reused", async () => {
  const a = await tok("sup.one"), b = await tok("sup.two"), c = await tok("cus.one");
  assert.equal((await call("/api/portal/studio/cat", { name: "x" }, a)).error, "bad_name");
  assert.equal((await call("/api/portal/studio/cat", { name: "نیم ست" }, c)).error, "no_upload");
  // already there (spaces and half-spaces do not matter)
  const ex = await call("/api/portal/studio/cat", { name: "نیم ست" }, a);
  assert.deepEqual([ex.ok, ex.cat, ex.exists], [true, "نیم‌ست", true]);
  const r = await call("/api/portal/studio/cat", { name: "  حلقه‌ی <b>ازدواج</b>  " }, a);
  assert.ok(r.ok && r.pending, JSON.stringify(r)); assert.equal(r.cat, "حلقه‌ی b ازدواج /b");
  const req = (await pull()).filter(x => x.c === "settings" && x.id.startsWith("vcq_")).pop();
  assert.equal(req.d.kind, "vcatreq"); assert.equal(req.d.by, "sup1"); assert.equal(req.d.byName, "کارگاه یک");
  // asked again: no second request
  await call("/api/portal/studio/cat", { name: "حلقه‌ی b ازدواج /b" }, a);
  assert.equal((await pull()).filter(x => x.c === "settings" && x.id.startsWith("vcq_") && x.d).length, 1);
  assert.deepEqual((await call("/api/portal/vitrin", null, a)).myCats, ["حلقه‌ی b ازدواج /b"]);
  assert.equal((await call("/api/portal/vitrin", null, b)).myCats, undefined, "another supplier does not see it");
  assert.ok(!(await call("/api/public/vitrin")).cats.some(x => x.name.includes("ازدواج")), "not public until the owner approves");
  // at most 5 waiting per supplier
  for (let i = 1; i <= 4; i++) assert.ok((await call("/api/portal/studio/cat", { name: "دسته " + i }, a)).ok);
  assert.equal((await call("/api/portal/studio/cat", { name: "دسته ۶" }, a)).error, "too_many_cats");
  // the owner approves (adds it to settings/vcats, deletes the request): it is public, and no longer waiting
  await sync([{ c: "settings", id: "vcats", d: { cats: [{ k: "ring", name: "انگشتر" }, { k: "c9", name: "حلقه‌ی b ازدواج /b" }] } }, { c: "settings", id: req.id, d: null }]);
  assert.ok((await call("/api/public/vitrin")).cats.some(x => x.k === "c9"));
  assert.ok(!(await call("/api/portal/vitrin", null, a)).myCats.includes("حلقه‌ی b ازدواج /b"));
});

test("studio save: a supplier picks groups; only group tags, and the owner's other tags on the piece stay", async () => {
  const a = await tok("sup.one"), m = await call("/api/portal/studio/media", { data: png }, a);
  const sv = await call("/api/portal/studio/save", { name: "دستبند بچگانه", cat: "دستبند", weight: "۲", groups: ["kids", "laser", "lux", "nope"], media: [m] }, a);
  assert.ok(sv.ok, JSON.stringify(sv));
  let d = (await last("vitrin", sv.id)).d;
  assert.deepEqual(d.tags, ["kids", "laser"], "lux is not a group, nope does not exist");
  assert.equal(d.cat, "دستبند"); assert.equal(d.pending, true);
  // the owner adds «لوکس» in the ledger; the supplier changes its groups: لوکس stays
  await sync([{ c: "vitrin", id: sv.id, d: { ...d, tags: ["kids", "laser", "lux"] } }]);
  await call("/api/portal/studio/save", { id: sv.id, name: "دستبند بچگانه", cat: "دستبند", weight: "۲", groups: ["jewel"], media: [m] }, a);
  d = (await last("vitrin", sv.id)).d;
  assert.deepEqual(d.tags, ["lux", "jewel"]);
});

test.after(() => server.close());
