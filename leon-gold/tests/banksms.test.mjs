// Bank SMS (owner, 2026-11-15): the shortcut key, messages filed by the server, explained here; balances from them.
// node tests/banksms.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3992";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8774);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-bm-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3992", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8774" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-bm-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9340", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9340/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8774/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('c1').set({name:'مشتری',kind:'customer'});" + T(1200));
  await ev("document.querySelector('#nav [data-tab=cash]').click();" + T(900) + "document.querySelector('#bmsec details:last-of-type summary').click();document.querySelector('[data-act=bmkey]').click();" + T(1200));
  const key = await ev("return document.getElementById('bmKey').value");
  check("the key is made in the ledger", key.length > 20, key);
  const send2 = text => fetch(API + "/api/public/banksms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: key, text }) }).then(r => r.status);
  check("the owner's two messages are taken", await send2("حساب9060005609\nبرداشت70,032,000\nمانده9,582,406\n05/08/20-12:17") === 200 && await send2("بلو\nبرداشت پول\nعلی عزیز، 1,980,000ریال از حساب شما پرید.\nموجودی: 88,069,637 ریال\n۲۲:۵۲\n۱۴۰۵.۰۸.۲۴") === 200);
  await ev(T(2500) + "document.querySelector('#nav [data-tab=home]').click();" + T(900));
  check("the home tells of 2 unexplained messages", await ev("return /۲ پیامک بانک بی‌توضیح/.test(document.getElementById('main').textContent)"));
  await ev("document.querySelector('#nav [data-tab=cash]').click();" + T(900));
  let t = await ev("return document.getElementById('main').textContent");
  check("both listed with amounts", /برداشت · ملت/.test(t) && /۷۰٬۰۳۲٬۰۰۰ ریال/.test(t) && /برداشت · سامان \(بلو\)/.test(t) && /۱٬۹۸۰٬۰۰۰ ریال/.test(t), t.slice(0, 500));
  check("balances from the messages", /^۹٬?۵۸۲٬?۴۰۶$/.test(await ev("return document.getElementById('bk_mellat').value")) && /^۸۸٬?۰۶۹٬?۶۳۷$/.test(await ev("return document.getElementById('bk_saman').value")));
  check("total of the bank: 97,652,043", /جمع موجودی بانک: ۹۷٬۶۵۲٬۰۴۳ ریال/.test(t), t.slice(0, 600));
  // explain the Mellat one
  await ev("const r=[...document.querySelectorAll('.bmr')].find(x=>/ملت/.test(x.textContent));r.querySelector('.bm-w').value='خرید طلا از بازار';r.querySelector('.bm-k').value='work';r.querySelector('[data-act=bmsave]').click();" + T(1200));
  t = await ev("return document.getElementById('main').textContent");
  check("explained: one left, and it shows its reason", /۱ پیامک بی‌توضیح/.test(t) && /کاری: خرید طلا از بازار/.test(t), t.slice(0, 600));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
