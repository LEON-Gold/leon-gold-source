// «نقدینگی و بانک» (owner, 2026-11-15): two bank accounts, money in and out, expenses by kind, spend room, sell gold, tips from his own numbers.
// node tests/cash.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3990";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8772);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-cash-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3990", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8772" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-cash-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9338", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9338/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8772/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // this month: a retail sale paid 50M; rent 40M, bills 5M; a supplier owed 80M rials. Before: three months of 30M sales and 20M rent
  const now = new Date(), iso = d => new Date(now.getTime() - d * 864e5).toISOString();
  await ev("const db=await window.claude.use('db');"
    + "await db.collection('parties').doc('c1').set({name:'مشتری',kind:'customer'});await db.collection('parties').doc('s1').set({name:'تأمین‌کننده',kind:'supplier',openR:-80000000});"
    + "await db.collection('invoices').doc('i0').set({kind:'retail',partyId:'c1',partyName:'مشتری',no:'1',date:'',ts:" + JSON.stringify(iso(0)) + ",amount:50000000,deltaR:0,unit:'r',items:[]});"
    + "await db.collection('expenses').doc('x1').set({cat:'rent',r:40000000,date:'',ts:" + JSON.stringify(iso(0)) + "});await db.collection('expenses').doc('x2').set({cat:'bills',r:5000000,date:'',ts:" + JSON.stringify(iso(0)) + "});"
    + "for(const k of [35,65,95]){await db.collection('invoices').doc('p'+k).set({kind:'retail',partyId:'c1',partyName:'مشتری',no:'p'+k,date:'',ts:new Date(Date.now()-k*864e5).toISOString(),amount:30000000,deltaR:0,unit:'r',items:[]});await db.collection('expenses').doc('e'+k).set({cat:'rent',r:20000000,date:'',ts:new Date(Date.now()-k*864e5).toISOString()})}" + T(1500));
  check("«نقدینگی و بانک» in the menu", await ev("return !!document.querySelector('#nav [data-tab=cash]')"));
  await ev("document.querySelector('#nav [data-tab=cash]').click();" + T(900));
  let t = await ev("return document.getElementById('main').textContent");
  check("the two accounts", /ملت/.test(t) && /سامان/.test(t) && /…۰۸۰۲/.test(t) && /…۸۴۵۱/.test(t), t.slice(0, 200));
  check("money in 50M, expenses 45M, net 5M positive", /ورودی‌?نقد۵۰٬۰۰۰٬۰۰۰/.test(t.replace(/\s+/g, "")) && /هزینه‌ها۴۵٬۰۰۰٬۰۰۰/.test(t.replace(/\s+/g, "")) && /خالص‌?این‌?ماه۵٬۰۰۰٬۰۰۰ریال·مثبت/.test(t.replace(/\s+/g, "")), t.slice(200, 600));
  check("rent is the largest share, and grew", /«اجاره» ۸۹٪ هزینه‌های این ماه/.test(t) && /«اجاره» از میانگین سه ماه قبل ۱۰۰٪ بیشتر/.test(t), t.slice(600, 1600));
  check("without bank balances, gold is needed for the 80M owed", /بدهی ریالی تو به طرف‌حساب‌ها ۸۰٬۰۰۰٬۰۰۰ ریال/.test(t) && /کم است/.test(t), t);
  await ev(set("#bk_mellat", "100000000") + set("#bk_saman", "50000000") + "document.querySelector('[data-act=savebanks]').click();" + T(1200));
  t = await ev("return document.getElementById('main').textContent");
  check("balances saved: 150M; no gold to sell", /جمع موجودی بانک: ۱۵۰٬۰۰۰٬۰۰۰ ریال/.test(t) && /نیازی به فروش طلا نیست/.test(t), t.slice(0, 400));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
