// Currencies and coins (owner, 2026-11-15): balances per currency and coin, the invoice's «ارز و سکه», holdings in «کالاها», the report.
// node tests/fx.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3989";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8771);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-fx-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3989", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8771" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-fx-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9337", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9337/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8771/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('c1').set({name:'صرافی آزمون',kind:'both'});"
    + "await db.collection('settlements').doc('s1').set({partyId:'c1',partyName:'صرافی آزمون',dir:'out',unit:'usd',amount:100,date:'',ts:'2026-11-10T10:00:00Z'});" + T(1200));
  // an invoice: a sale, and two coins received from him in the same invoice
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=c1]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=retail]').click();" + T(1200));
  await ev(set("#retail .gp", "1000000") + set("#rt tbody tr .q", "1") + set("#rt tbody tr .w", "2") + T(300));
  check("the invoice has «ارز و سکه»", await ev("return [...document.querySelectorAll('#form .fsheet, #form .sec')].some(s=>/ارز و سکه/.test(s.querySelector('h2')?.textContent||''))"));
  await ev("document.querySelector('.fxadd').click();" + T(200) + "const r=document.querySelector('.fxr');r.querySelector('.fxu').value='cn';r.querySelector('.fxu').dispatchEvent(new Event('change',{bubbles:true}));r.querySelector('.fxn').value='2';r.querySelector('.fxn').dispatchEvent(new Event('input',{bubbles:true}));" + T(200));
  // the printed invoice shows them on its last page
  await ev("document.getElementById('pvBtn').click();" + T(900));
  const pv = await ev("const P=[...document.querySelectorAll('#pages>.sheet')];return JSON.stringify({n:P.length,last:P[P.length-1]?.querySelector('.fxp:not([hidden])')?.textContent||''})");
  check("the printed invoice lists the coins", /سکه طرح جدید/.test(pv) && /۲ عدد/.test(pv) && /دریافتی از شما/.test(pv), pv);
  await ev("document.getElementById('pvClose').click();" + T(300));
  await ev("document.getElementById('saveInv').click();" + T(1500));
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const inv = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "invoices" && x.d);
  check("the invoice keeps its coins", inv.length === 1 && JSON.stringify(inv[0].d.fx) === '[{"u":"cn","n":2,"dir":"in"}]', JSON.stringify(inv.map(x => x.d.fx)));
  // the party's page: dollar owed by him, coins owed to him
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=c1]').click();" + T(800));
  const pg = await ev("return document.getElementById('main').textContent");
  check("dollar balance: 100, he owes", /مانده دلار۱۰۰ دلاربدهکار/.test(pg.replace(/\s+/g, "")) || (/مانده دلار/.test(pg) && /۱۰۰ دلار/.test(pg)), pg.slice(0, 300));
  check("coin balance: 2, owed to him", /مانده سکه طرح جدید/.test(pg) && /۲ سکه طرح جدید/.test(pg), pg.slice(0, 300));
  check("the statement lists both", /دریافت سکه طرح جدید/.test(pg) && /پرداخت به او/.test(pg));
  // «کالاها»: holdings −100 dollars, +2 coins; an opening count
  await ev("document.querySelector('#nav [data-tab=products]').click();" + T(900));
  let pr = await ev("return document.getElementById('fxsec')?.textContent||''");
  check("holdings: coins +2, dollars −100", /سکه طرح جدید۲ عدد/.test(pr.replace(/\s+/g, " ").replace(/ /g, "")) || (/۲ عدد/.test(pr) && /-?۱۰۰ دلار/.test(pr)), pr.slice(0, 300));
  await ev("document.querySelector('#fxsec details summary').click();" + set("#fxo_usd", "500") + "document.querySelector('[data-act=fxopen]').click();" + T(1200) + "document.querySelector('#nav [data-tab=parties]').click();" + T(400) + "document.querySelector('#nav [data-tab=products]').click();" + T(900));
  pr = await ev("return document.getElementById('fxsec')?.textContent||''");
  check("an opening count: 500 − 100 = 400 dollars", /۴۰۰ دلار/.test(pr), pr.slice(0, 300));
  // home and report
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(900));
  check("home balances list currencies", await ev("return /ارز و سکه/.test(document.querySelector('#main .dbal')?.textContent||'')"));
  await ev("document.querySelector('#nav [data-tab=report]').click();" + T(1500));
  check("the report counts currencies and coins", await ev("return /ارزش موجودی ارز و سکه/.test(document.getElementById('main').textContent)"));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
