// «پنل مدیریت» inside the ledger, and each party's «حساب من» username and password: the owner makes a starting pair,
// the party signs in with it and changes its password; the panel shows balances, how each party pays, orders and receipts.
// node tests/admin.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
// SHOT_DIR=<folder> saves 390px screenshots of the panel.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3997";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8774);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-admin-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3997", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8774" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const call = async (p, body, token) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-admin-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9339", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9339/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8774/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
const tap = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click();await new Promise(r=>setTimeout(r,700))`);
const day = n => new Date(Date.now() - n * 864e5).toISOString();

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();await new Promise(r=>setTimeout(r,1800))");
  check("signed in to the ledger as the owner", await ev("return !document.getElementById('entry')&&window.__leonSync.info().on"));

  // three customers: one who pays within days, one with a debt open for 90 days, one with nothing owed
  await ev(`const db=await window.claude.use('db'),put=(c,i,d)=>db.collection(c).doc(i).set(d);
    await put('parties','c1',{name:'مریم رضایی',kind:'customer',phone:'09121112233',ts:${JSON.stringify(day(200))}});
    await put('parties','c2',{name:'علی محمدی',kind:'customer',phone:'09123334455',ts:${JSON.stringify(day(200))}});
    await put('parties','c3',{name:'سارا کریمی',kind:'customer',ts:${JSON.stringify(day(200))}});
    await put('invoices','i1',{kind:'retail',no:'1',partyId:'c1',partyName:'مریم رضایی',amount:50000000,deltaR:50000000,ts:${JSON.stringify(day(40))}});
    await put('settlements','s1',{partyId:'c1',partyName:'مریم رضایی',dir:'in',unit:'r',amount:50000000,ts:${JSON.stringify(day(37))}});
    await put('invoices','i2',{kind:'retail',no:'2',partyId:'c1',partyName:'مریم رضایی',amount:20000000,deltaR:20000000,ts:${JSON.stringify(day(5))}});
    await put('invoices','i3',{kind:'retail',no:'3',partyId:'c2',partyName:'علی محمدی',amount:90000000,deltaR:90000000,ts:${JSON.stringify(day(90))}});
    await put('orders','o1',{partyId:'c2',partyName:'علی محمدی',status:'src',due:'۱۴۰۰/۰۱/۰۱',items:[{desc:'گردنبند اسم',qty:1}],ts:${JSON.stringify(day(10))}});`);
  await sleep(2500);

  check("«پنل مدیریت» is in the menu for everyone signed in", await ev("var b=document.querySelector('#nav [data-tab=admin]');return !!b&&!b.hidden"));
  await tap("#nav [data-tab=admin]"); await sleep(800);
  const rows = await ev("return [...document.querySelectorAll('#alst .row')].map(r=>r.textContent)");
  check("the panel lists every party", rows.length === 3, JSON.stringify(rows));
  check("the 90-day debt is first and marked «دیرکرد»", /علی محمدی/.test(rows[0]) && /دیرکرد/.test(rows[0]) && /سفارش دیر/.test(rows[0]));
  check("the one who paid in 3 days is «خوش‌حساب» with that average", rows.some(r => /مریم رضایی/.test(r) && /خوش‌حساب/.test(r) && /میانگین تسویه ۳ روز/.test(r)));
  check("no debt history, no grade", rows.some(r => /سارا کریمی/.test(r) && !/حساب|دیرکرد|معمولی/.test(r.replace("سارا کریمی", ""))));
  await shot("admin-list.png");
  await tap("#achips [data-f=late]");
  check("the «دیرکرد» filter keeps only the late payer", (await ev("return [...document.querySelectorAll('#alst .row')].map(r=>r.textContent).join('|')")).match(/علی محمدی/) && !(await ev("return document.getElementById('alst').textContent")).includes("مریم"));
  await tap("#achips [data-f=all]");

  // the owner makes a starting username and password for one customer, from the party's own panel page
  await tap("#alst [data-id=c1]"); await sleep(600);
  check("a party's page shows how they pay, their invoices and the «حساب من» sign-in", await ev("return /میانگین زمان تسویه/.test(main.textContent)&&document.querySelectorAll('#main [data-act=inv]').length===2&&!!document.querySelector('[data-act=ptcred]')"));
  await shot("admin-party.png");
  await tap("[data-act=ptcred]"); await sleep(800);
  const cred = await ev("var c=document.querySelector('.modal .cred');return c?[...c.querySelectorAll('i')].map(s=>s.textContent):null");
  check("the starting username is the mobile and the password six digits", cred && cred[0] === "09121112233" && /^\d{6}$/.test(cred[1]), JSON.stringify(cred));
  await shot("admin-cred.png");
  await ev("document.querySelector('.modal [data-n]').click()");

  // the customer signs in with it, changes the password, and sends a receipt the owner then sees
  const t = (await call("/api/portal/login", { u: cred[0], p: cred[1] })).token;
  check("the customer signs in to «حساب من» with the starting pair", !!t);
  check("and changes the password", (await call("/api/portal/password", { old: cred[1], new: "mypass77" }, t)).ok === true);
  check("the starting password no longer works", (await call("/api/portal/login", { u: cred[0], p: cred[1] })).status === 401);
  await call("/api/portal/receipt", { image: "data:image/png;base64," + Buffer.from([137, 80, 78, 71]).toString("base64"), amount: 20000000, date: "1405/08/09" }, t);

  // «ساخت برای همه» in «کاربران» covers the rest, skipping whoever already has a username
  await ev("document.querySelector('#nav [data-tab=users]').click();await new Promise(r=>setTimeout(r,800));document.querySelector('[data-act=sutab][data-k=parties]').click();await new Promise(r=>setTimeout(r,1200))");
  check("«کاربران» shows the username beside the party", /09121112233/.test(await ev("return document.getElementById('suparties').textContent")));
  await ev("document.querySelector('[data-act=ptcredall]').click();await new Promise(r=>setTimeout(r,300));document.querySelector('.modal [data-y]').click();await new Promise(r=>setTimeout(r,2500))");
  const all = await ev("return [...document.querySelectorAll('.modal .cred b')].map(b=>b.textContent)");
  check("making them for everyone covers only the two without one", all.length === 2 && !all.includes("مریم رضایی"), JSON.stringify(all));
  check("a party without a mobile gets a «leon» username", /leon\d{4}/.test(await ev("return document.querySelector('.modal .creds').textContent")));
  await shot("admin-all.png");
  await ev("document.querySelector('.modal [data-n]').click()");
  check("the server has three usernames", (await call("/api/portal/logins", null, await ev("return window.__leonSync.info()&&null") || (await call("/api/login", { u: "مالک", p: "9999" })).token)).logins.length === 3);

  // the receipt shows in the panel and on the customer's page
  await tap("#nav [data-tab=admin]"); await sleep(1500);
  check("the panel counts the new receipt", (await ev("return document.getElementById('admRc').textContent")) === "۱");
  await tap("#alst [data-id=c1]"); await sleep(1200);
  check("the customer's page lists the receipt as waiting", /در انتظار/.test(await ev("return main.textContent")));
  await shot("admin-receipt.png");
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
