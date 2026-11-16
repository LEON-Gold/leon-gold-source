// Invoice fixes (owner, 2026-11-14, task 24): a section «ذخیره» on an opened invoice saves it (the balance moves); a product row's weight follows its count; the picker shows no average weight; the A5 preview fits a laptop screen.
// node tests/invfix.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3985";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8767);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-eb-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3985", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8767" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-eb-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9333", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9333/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8767/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // Leon keeps 100 grams with the bullion dealer; it buys a 10-gram piece from the neighbour and pays by a transfer from that account
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('c1').set({name:'مشتری آزمون',kind:'customer',openR:1000000});await db.collection('products').doc('p1').set({name:'النگو آزمون',code:'77',carat:18,ajrat:10,openQ:3,openG:12});" + T(900));
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const invs = async () => (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "invoices" && x.d);
  const partyRow = () => ev("document.querySelector('#nav [data-tab=parties]').click();" + T(500) + "return document.querySelector('[data-act=party][data-id=c1]').textContent");
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=c1]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=retail]').click();" + T(1200));

  // 4) the picker: no «هر عدد», the stock total is there; picking fills 4 g for one; count 3 → 12 g
  await ev("document.querySelector('.ppk-b').click();" + T(500));
  const pk = await ev("const r=document.querySelector('.ppk [data-p=p1]');return r.textContent");
  check("picker shows no average weight", !/هر عدد/.test(pk), pk);
  check("picker shows the stock total", /۳ عدد/.test(pk) && /۱۲/.test(pk), pk);
  await ev("document.querySelector('.ppk [data-p=p1]').click();" + T(700));
  const w1 = await ev("return document.querySelector('#rt tbody tr .w').value");
  await ev(set("#rt tbody tr .q", "3") + T(400));
  const w3 = await ev("return document.querySelector('#rt tbody tr .w').value");
  check("one piece fills 4 g", /^(۴|4)$/.test(w1), w1);
  check("count 3 makes the weight 12 g", /^(۱۲|12)$/.test(w3), w3);
  const fw = await ev("return [...document.querySelectorAll('#form input')].map(i=>i.value).filter(v=>/^(۱۲|12)$/.test(v)).length");
  check("the phone form shows the new weight too", fw > 0);
  await ev(set("#rt tbody tr .w", "11.5") + T(200) + set("#rt tbody tr .q", "2") + T(300));
  check("a weight typed by hand stays", /11[.٫]5|۱۱[.٫]۵/.test(await ev("return document.querySelector('#rt tbody tr .w').value")));

  // 3) save; open it again; unlock; change it in a section and press that section's «ذخیره» only
  await ev(set("#retail .gp", "1000000") + set("#rt tbody tr .aj", "") + set("#rt tbody tr .q", "1") + set("#rt tbody tr .w", "2") + T(400));
  await ev("document.getElementById('saveInv').click();" + T(1500));
  check("first save: balance 3,000,000", /۳٬۰۰۰٬۰۰۰/.test(await partyRow()));
  await ev("document.querySelector('[data-act=party][data-id=c1]').click();" + T(800) + "document.querySelector('[data-act=inv]').click();" + T(1200));
  await ev("[...document.querySelectorAll('[data-act=unlockinv]')].find(b=>b.offsetParent).click();" + T(400) + "[...document.querySelectorAll('.modal [data-y]')].pop().click();" + T(700));
  await ev("document.querySelector('.invrow').click();" + T(300));
  await ev(set("#rt tbody tr .w", "3") + T(300));
  await ev("const s=[...document.querySelectorAll('#form .fsheet')].find(x=>!x.hidden);s.querySelector('.fsave').click();" + T(1500));
  const all = await invs();
  check("the section «ذخیره» wrote the invoice", all.length === 1 && all[0].d.deltaR === 3000000, JSON.stringify(all.map(x => x.d.deltaR)));
  check("still open for the next section", await ev("return !document.querySelector('.lockbar')&&!!document.querySelector('.invmenu')"));
  check("the party's balance moved to 4,000,000", /۴٬۰۰۰٬۰۰۰/.test(await partyRow()), await partyRow());
  // a section «ذخیره» with nothing changed writes nothing new
  await ev("document.querySelector('[data-act=party][data-id=c1]').click();" + T(800) + "document.querySelector('[data-act=inv]').click();" + T(1200));
  await ev("[...document.querySelectorAll('[data-act=unlockinv]')].find(b=>b.offsetParent).click();" + T(400) + "[...document.querySelectorAll('.modal [data-y]')].pop().click();" + T(700));
  const n0 = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.length;
  await ev("document.querySelector('.invrow').click();" + T(300) + "const s=[...document.querySelectorAll('#form .fsheet')].find(x=>!x.hidden);s.querySelector('.fsave').click();" + T(1200));
  const n1 = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.length;
  check("no change, no write", n1 === n0, n0 + " → " + n1);

  // 2) the A5 preview on a laptop (1366×768) and on a phone: one whole page in view, centred
  for (const [w, h, mob] of [[1366, 768, false], [1280, 650, false], [390, 844, true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: mob }, sid); await sleep(300);
    await ev("document.getElementById('pvBtn').click();" + T(900));
    const r = await ev("const p=document.querySelector('#pages>.sheet').getBoundingClientRect(),b=document.getElementById('pvbar').getBoundingClientRect(),f=document.getElementById('pvfoot').getBoundingClientRect();return {top:p.top,bottom:p.bottom,left:p.left,right:p.right,bb:b.bottom,ft:f.top,vw:innerWidth}");
    check(`${w}×${h}: the whole page fits between the bars`, r.top >= r.bb - 1 && r.bottom <= r.ft + 1, JSON.stringify(r));
    check(`${w}×${h}: centred, inside the screen`, r.left >= -1 && r.right <= r.vw + 1 && Math.abs(r.left - (r.vw - r.right)) < 20, JSON.stringify(r));
    if (w === 1366) await send("Page.captureScreenshot", {}, sid).then(x => fs.writeFileSync(process.env.SHOT || "/dev/null", Buffer.from(x.result.data, "base64")));
    await ev("document.getElementById('pvClose').click();" + T(300));
  }
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack, e.cause); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
process.exit(fails ? 1 : 0);
