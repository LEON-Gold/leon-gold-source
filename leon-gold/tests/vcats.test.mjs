// «افزودن کتگوری» and «گروه» in the ledger (owner, 2026-11-13): groups are tags with group:true (لیزری، ریخته، پایه جواهر،
// بچگانه by default), categories are settings/vcats; a supplier proposes a category from «حساب من» and the owner approves it.
// node tests/vcats.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3996";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8776);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vcats-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3996", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8776" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const call = async (p, body, token) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vcats-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9341", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9341/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8776/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;


try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='۹۹۹۹';document.getElementById('entryForm').requestSubmit();" + T(1800));
  check("signed in", await ev("return !document.getElementById('entry')&&window.__leonSync.info().on"));
  await ev("var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='بعداً');if(b)b.click();" + T(300));
  const owner = (await call("/api/login", { u: "مالک", p: "9999" })).token;
  const pull = async () => (await call("/api/pull?since=0", null, owner)).changes;
  // a supplier that may upload (with a «حساب من» login) and one piece in «انگشتر»
  await call("/api/push", { changes: [
    { c: "parties", id: "sup9", d: { name: "کارگاه نمونه", kind: "supplier", upload: true } },
    { c: "vitrin", id: "v1", d: { name: "انگشتر ساده", cat: "انگشتر", weight: 2, show: true, media: [], tags: ["laser"], ts: "2026-11-01T00:00:00Z" } },
  ] }, owner);
  await call("/api/portal/login/set", { partyId: "sup9", username: "sup.nine", password: "Gold1405" }, owner);
  const sup = (await call("/api/portal/login", { u: "sup.nine", p: "Gold1405" })).token;
  const r = await call("/api/portal/studio/cat", { name: "حلقه ازدواج" }, sup);
  check("a supplier proposes a category from «حساب من»", r.ok && r.pending, JSON.stringify(r));
  await ev(T(2500));
  await ev("document.querySelector('#nav [data-tab=vitrin]').click();" + T(800));
  check("«ویترین» says a category waits", /۱ کتگوری تازه از تأمین‌کننده/.test(await ev("return main.textContent")));
  check("«افزودن کتگوری» and «گروه‌ها و نوع کار» on the page", await ev("return !!document.querySelector('.vtop [data-act=vcatedit]')&&!!document.querySelector('.vtop [data-act=vtagedit]')"));
  await shot("vitrin-page-390.png");

  // «افزودن کتگوری»
  await ev("document.querySelector('.vtop [data-act=vcatedit]').click();" + T(400));
  check("the dialog lists the 11 default categories", (await ev("return document.querySelectorAll('#vcList .bzr').length")) === 11);
  check("and the supplier's proposal, with who sent it", /حلقه ازدواج[\s\S]*کارگاه نمونه/.test(await ev("return document.getElementById('vcReq').textContent")));
  check("«انگشتر» counts its piece", /۱ کار/.test(await ev("return document.querySelector('#vcList .bzr').textContent")));
  await shot("vcats-dialog-390.png");
  // rename the first, move «گردنبند» above it, approve the proposal, save
  await ev("document.querySelector('#vcList .bzr .bzn').value='انگشترها';document.querySelector('[data-up=\"1\"]').click();" + T(100)
    + "document.querySelector('[data-qok]').click();" + T(100) + "document.querySelector('.modal form').requestSubmit();" + T(1500));
  const vc = (await pull()).filter(c => c.c === "settings" && c.id === "vcats").pop();
  const cats = vc && vc.d ? vc.d.cats : [];
  check("saved in order; the renamed one keeps its old name", JSON.stringify(cats.slice(0, 2)) === JSON.stringify([{ k: "necklace", name: "گردنبند" }, { k: "ring", name: "انگشترها", alias: ["انگشتر"] }]), JSON.stringify(cats.slice(0, 2)));
  check("the approved category is added", cats.length === 12 && cats[11].name === "حلقه ازدواج");
  check("its request is removed", !(await pull()).some(c => c.c === "settings" && c.id.startsWith("vcq_") && c.d));
  check("public showcase: the new category", (await call("/api/public/vitrin")).cats.some(c => c.name === "حلقه ازدواج"));
  check("the old piece is in the renamed category (nothing rewritten)", /انگشترها \(۱\)/.test(await ev("return [...document.querySelectorAll('#vctSel option')].map(o=>o.textContent).join(',')")));
  check("the waiting note is gone", !/کتگوری تازه از تأمین‌کننده/.test(await ev("return main.textContent")));

  // «گروه‌ها و نوع کار»
  await ev("document.querySelector('.vtop [data-act=vtagedit]').click();" + T(400));
  check("the tags dialog ticks the default groups", (await ev("return [...document.querySelectorAll('.modal .bzr')].map(r=>r.querySelector('.bzgc').checked?1:0).join('')")) === "001111");
  await shot("vtags-dialog-390.png");
  await ev("document.querySelector('.modal .bzr .bzgc').click();document.querySelector('.modal form').requestSubmit();" + T(1500));
  const vt = (await pull()).filter(c => c.c === "settings" && c.id === "vtags").pop();
  check("every tag is saved with its group flag", !!vt && vt.d.tags.every(t => typeof t.group === "boolean") && vt.d.tags.filter(t => t.group).map(t => t.k).join(",") === "lux,laser,cast,jewel,kids", vt && JSON.stringify(vt.d.tags));
  check("the public groups follow", (await call("/api/public/vitrin")).groups.map(g => g.k).join(",") === "lux,laser,cast,jewel,kids");

  // a piece's form: «گروه» apart from «نوع کار», the owner's categories
  await ev("document.querySelector('[data-act=newvit]').click();" + T(600));
  check("«گروه» lists the groups", (await ev("return [...document.querySelectorAll('#vgrBox .vtg')].map(i=>i.value).join(',')")) === "lux,laser,cast,jewel,kids");
  check("«نوع کار» lists the rest", (await ev("return [...document.querySelectorAll('#vtgBox .vtg')].map(i=>i.value).join(',')")) === "minimal");
  const dl = await ev("return [...document.querySelectorAll('#vt_cats option')].map(o=>o.value).join(',')");
  check("the category list is the owner's", dl.startsWith("گردنبند,انگشترها") && dl.endsWith("حلقه ازدواج"), dl);
  await ev("document.getElementById('vgrBox').scrollIntoView({block:'center'});" + T(300)); await shot("vitrin-groups-form-390.png");
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
