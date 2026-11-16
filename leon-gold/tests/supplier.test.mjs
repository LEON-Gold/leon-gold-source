// A piece brought in by a supplier's received doc shows its supplier and both wages in «کالاها» (owner, 2026-11-15).
// node tests/supplier.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3986";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8768);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-sup-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3986", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8768" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-sup-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9334", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9334/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8768/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('s1').set({name:'طلاسازی آزمون',kind:'supplier'});"
    + "await db.collection('products').doc('old1').set({code:'90',name:'گردنبند قدیمی',carat:750,ajrat:12,buyAjrat:6,openQ:0,openG:0});"
    + "await db.collection('invoices').doc('rcold').set({kind:'whole',doc:'rc',no:'1',date:'',partyId:'s1',partyName:'طلاسازی آزمون',vals:[],rows:1,tax:'۰',ts:'2026-10-01T10:00:00Z',items:[{desc:'۹۰ گردنبند قدیمی',qty:1,weight:5,carat:750,ajrat:6,pid:'old1'}],unit:'g',amount:5,deltaG:-5});" + T(900));
  // a received doc from the supplier brings a new piece in
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=s1]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=whole]').click();" + T(1200));
  await ev(set("#w_doc", "rc") + set("#wt tbody tr td:nth-child(2) input", "النگو آزمون") + set("#wt tbody tr .q", "2") + set("#wt tbody tr .w", "10") + set("#wt tbody tr .c", "750") + set("#wt tbody tr .aj", "7") + T(400));
  await ev("document.getElementById('saveInv').click();" + T(1800));
  const row = name => ev("document.querySelector('#nav [data-tab=products]').click();" + T(700) + "const r=[...document.querySelectorAll('[data-act=prod]')].find(b=>b.textContent.includes(" + JSON.stringify(name) + "));return r?r.textContent:''");
  const r1 = await row("النگو آزمون");
  check("the new piece names its supplier", /تأمین‌کننده: طلاسازی آزمون/.test(r1), r1);
  check("and the wage on the supplier's doc", /اجرت دریافتی ۷٪/.test(r1), r1);
  const r0 = await row("گردنبند قدیمی");
  check("an older piece finds its supplier from its received doc", /تأمین‌کننده: طلاسازی آزمون/.test(r0) && /اجرت دریافتی ۶٪/.test(r0), r0);
  // its page, then the paid wage typed by the owner
  await ev("[...document.querySelectorAll('[data-act=prod]')].find(b=>b.textContent.includes('النگو آزمون')).click();" + T(700));
  const pg = await ev("return document.getElementById('main').textContent");
  check("its page shows supplier and both wages", /تأمین‌کننده و اجرت/.test(pg) && /طلاسازی آزمون/.test(pg) && /خالی؛ در «ویرایش کالا» پرش کن/.test(pg), pg.slice(0, 200));
  await ev("document.querySelector('[data-act=editprod]').click();" + T(700));
  check("the form has both wages", await ev("return !!document.getElementById('pr_buy')&&!!document.getElementById('pr_pay')&&/تأمین‌کننده: طلاسازی آزمون/.test(document.getElementById('main').textContent)"));
  check("a piece with no group or category is marked", /گروه و دسته تعیین نشده/.test(r1), r1);
  // groups and category (owner, 2026-11-15): one of them must be set
  await ev(set("#pr_pay", "9") + "document.querySelector('[data-act=saveprod]').click();" + T(900));
  check("saving with neither is refused", await ev("return !!document.getElementById('pr_pay')"));
  check("the category list is the vitrin's", await ev("return [...document.querySelectorAll('#pr_cat option')].some(o=>o.textContent==='النگو')"));
  await ev("document.querySelector('#prGrp .vtg[value=cast]').click();" + set("#pr_cat", "النگو") + "document.querySelector('[data-act=saveprod]').click();" + T(1200));
  const r2 = await row("النگو آزمون");
  check("the paid wage shows, the supplier stays", /اجرت پرداختی ۹٪/.test(r2) && /تأمین‌کننده: طلاسازی آزمون/.test(r2), r2);
  check("the row shows its group and category", /ریخته/.test(r2) && /النگو/.test(r2) && !/تعیین نشده/.test(r2), r2);
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const prods = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "products" && x.d);
  const np = prods.find(x => x.d.name === "النگو آزمون");
  check("stored on the piece: supplier, both wages", np && np.d.supId === "s1" && np.d.supName === "طلاسازی آزمون" && np.d.buyAjrat === 7 && np.d.payAjrat === 9 && JSON.stringify(np.d.tags) === '["cast"]' && np.d.cat === "النگو", JSON.stringify(np && np.d));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
