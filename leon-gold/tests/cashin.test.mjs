// Cash on an invoice (owner, 2026-11-15): which account, «کاری» or «شخصی», why (required); reminders for personal money, business money waits for its payment.
// node tests/cashin.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3991";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8773);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-cin-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3991", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8773" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-cin-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9339", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9339/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8773/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('c1').set({name:'مشتری',kind:'customer'});" + T(1200));
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const invs = async () => (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "invoices" && x.d).map(x => x.d);
  const cin = (sel, v) => "{const e=document.querySelector('#form " + sel + "');e.value=" + JSON.stringify(v) + ";e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('input',{bubbles:true}))}";
  const newInv = () => ev("document.querySelector('#nav [data-tab=parties]').click();" + T(500) + "document.querySelector('[data-act=party][data-id=c1]').click();" + T(500) + "document.querySelector('[data-act=new][data-k=retail]').click();" + T(1000));
  await newInv();
  await ev(set("#retail .gp", "1000000") + set("#rt tbody tr .q", "1") + set("#rt tbody tr .w", "2") + set("#retail .rp", "2000000") + T(400));
  check("the invoice has «ورود نقدی» with its amount", await ev("return [...document.querySelectorAll('#form .sec')].some(s=>/ورود نقدی/.test(s.querySelector('h2')?.textContent||'')&&/۲٬۰۰۰٬۰۰۰ ریال/.test(s.textContent))"));
  await ev("document.getElementById('saveInv').click();" + T(1200));
  check("not saved without the account, kind and why", (await invs()).length === 0);
  await ev(cin(".cin-a", "mellat") + T(100) + cin(".cin-k", "own") + T(200) + cin(".cin-w", "پس‌انداز خرید ماشین") + cin(".cin-s", "500000") + T(200));
  await ev("document.getElementById('saveInv').click();" + T(1500));
  let L = await invs();
  check("saved with its cash: personal, Mellat, why, to spend", L.length === 1 && JSON.stringify(L[0].cash) === JSON.stringify({ amount: 2000000, acct: "mellat", kind: "own", why: "پس‌انداز خرید ماشین", spend: 500000 }), JSON.stringify(L.map(x => x.cash)));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(800));
  check("the home reminds of the personal money", await ev("return /یادآوری پول‌های شخصی/.test(document.getElementById('main').textContent)&&/پس‌انداز خرید ماشین/.test(document.getElementById('main').textContent)"));
  // a business one, then its payment
  await newInv();
  await ev(set("#retail .gp", "1000000") + set("#rt tbody tr .q", "1") + set("#rt tbody tr .w", "3") + set("#retail .rp", "3000000") + T(400));
  await ev(cin(".cin-a", "saman") + T(100) + cin(".cin-k", "work") + T(200) + cin(".cin-w", "پول طلای تأمین‌کننده") + T(200) + "document.getElementById('saveInv').click();" + T(1500));
  await ev("document.querySelector('#nav [data-tab=cash]').click();" + T(900));
  let t = await ev("return document.getElementById('main').textContent");
  check("cash page: the personal one with its gold comparison place", /پول‌های شخصی/.test(t) && /پس‌انداز خرید ماشین/.test(t) && /باید خرج شود: ۵۰۰٬۰۰۰ ریال/.test(t), t.slice(-700));
  check("cash page: the business one waits for its payment", /منتظر سند پرداختی/.test(t) && /پول طلای تأمین‌کننده/.test(t));
  await ev("const db=await window.claude.use('db');await db.collection('settlements').doc('o1').set({partyId:'c1',partyName:'مشتری',dir:'out',unit:'r',amount:3000000,date:'',ts:new Date(Date.now()+60000).toISOString()});" + T(1200) + "document.querySelector('#nav [data-tab=home]').click();" + T(300) + "document.querySelector('#nav [data-tab=cash]').click();" + T(900));
  t = await ev("return document.getElementById('main').textContent");
  check("paid out: it leaves the list", !/پول طلای تأمین‌کننده/.test(t) && /همه‌ی پول‌های کاری پرداخت شده‌اند/.test(t));
  await ev("[...document.querySelectorAll('[data-act=cindone]')][0].click();" + T(1200));
  t = await ev("return document.getElementById('main').textContent");
  check("«انجام شد» takes the personal one off", /پول شخصیِ باز نیست/.test(t));
  // the bank balances move with the invoices' money (owner, 2026-11-16): Mellat +2M, Saman +3M from no balance set
  check("bank total follows the invoices: 5M", /جمع موجودی بانک: ۵٬۰۰۰٬۰۰۰ ریال/.test(t), (t.match(/جمع موجودی بانک[^ر]*ریال/) || [""])[0]);
  // money paid out on an invoice: «خروج نقدی» asks too, and takes it off the account
  await newInv();
  await ev(set("#retail .gp", "1000000") + set("#rt tbody tr .q", "1") + set("#rt tbody tr .w", "1") + set("#retail .rp", "500000") + set("#r_p1_t", "dr") + T(400));
  check("paid out: «خروج نقدی» shows its amount", await ev("return [...document.querySelectorAll('#form .cin-note')].some(n=>n.dataset.d==='o'&&/۵۰۰٬۰۰۰ ریال/.test(n.textContent))"));
  const n0 = (await invs()).length;
  await ev("document.getElementById('saveInv').click();" + T(1200));
  check("not saved without the paying account, kind and why", (await invs()).length === n0);
  await ev(cin(".cout-a", "mellat") + T(100) + cin(".cout-k", "work") + T(100) + cin(".cout-w", "پس دادن پول مشتری") + T(200) + "document.getElementById('saveInv').click();" + T(1500));
  L = await invs();
  const out = L.filter(x => x.cashOut)[0];
  check("saved with its cash out", out && JSON.stringify(out.cashOut) === JSON.stringify({ amount: 500000, acct: "mellat", kind: "work", why: "پس دادن پول مشتری" }), JSON.stringify(out && out.cashOut));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(300) + "document.querySelector('#nav [data-tab=cash]').click();" + T(900));
  t = await ev("return document.getElementById('main').textContent");
  check("bank total after the payment: 4.5M", /جمع موجودی بانک: ۴٬۵۰۰٬۰۰۰ ریال/.test(t), (t.match(/جمع موجودی بانک[^ر]*ریال/) || [""])[0]);
  // wholesale: «پرداخت ریالی (تبدیل به گرم)» is money too
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(500) + "document.querySelector('[data-act=party][data-id=c1]').click();" + T(500) + "document.querySelector('[data-act=new][data-k=whole]').click();" + T(1000));
  await ev(set("#w_cash", "7000000") + T(400));
  check("wholesale: the rial payment asks for its account", await ev("return [...document.querySelectorAll('#form .cin-note')].some(n=>n.dataset.d==='i'&&/۷٬۰۰۰٬۰۰۰ ریال/.test(n.textContent))"));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
