// «اعلان‌های حساب من» (owner, 2026-11-10): everything from «حساب من» (sign-ups, orders, receipts) stays in one list, newest
// first, even after «دیدم» takes it off the home page. node tests/feed.test.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3984";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8770);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-feed-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3984", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8770" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-feed-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9336", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9336/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8770/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(2500));
  await ev("const s=document.getElementById('nfSheet');if(s)s.remove();");
  const post = async (p, b, tok) => { const r = await fetch(API + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const sara = await post("/api/portal/signup", { fullName: "سارا رضایی", mobile: "09121234567", nationalId: "0084575948", biz: "retail", username: "sara.r", password: "Gold1405" });
  await sleep(1100);
  const code = (await post("/api/portal/invite", null, sara.token)).code;
  await post("/api/portal/signup", { fullName: "مینا احمدی", mobile: "09127654321", nationalId: "0012345601", biz: "retail", username: "mina.a", password: "Gold1405", ref: code });
  await sleep(1100);
  const own = (await post("/api/login", { u: "مالک", p: "9999" })).token;
  await post("/api/push", { changes: [{ c: "crm_leads", id: "ld1", d: { name: "سارا رضایی", what: "دستبند تنیسی (۱۲)", source: "حساب من", status: "talking", ts: new Date().toISOString() } }] }, own);
  await sleep(1100);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const rc = await post("/api/portal/receipt", { image: png, amount: 50000000 }, sara.token);
  check("a receipt is sent", rc.ok === true, JSON.stringify(rc));
  await ev("window.__leonSync.now();" + T(2500) + "document.querySelector('#nav [data-tab=home]').click();" + T(800));
  check("the home page bell says how many are new", /^[۲۳]$/.test(await ev("const r=document.querySelector('.dhead .dico em');return r?r.textContent:''")), await ev("const r=document.querySelector('.dhead .dico em');return r?r.textContent:''"));
  check("the menu shows a count", await ev("const b=document.querySelector('#nav [data-tab=feed] .nb');return !!b"));
  // «دیدم» on both sign-ups: they leave the home page…
  await ev("for(let i=0;i<3;i++){const b=document.querySelector('#suSec [data-act=suok]');if(b){b.click();await new Promise(r=>setTimeout(r,300))}}");
  check("«دیدم» takes the sign-ups off the home page", await ev("return !document.getElementById('suSec')"));
  // …but stay in the feed, newest first
  await ev("document.querySelector('#nav [data-tab=feed]').click();" + T(2500));
  const rows = await ev("return [...document.querySelectorAll('.feed .row .t')].map(t=>t.textContent)");
  check("all four from «حساب من» are listed", rows.length === 4, JSON.stringify(rows));
  check("newest first: the receipt, the order, then Mina, then Sara", /رسید/.test(rows[0]) && /سفارش/.test(rows[1]) && /مینا/.test(rows[2]) && /سارا/.test(rows[3]), JSON.stringify(rows));
  check("the seen sign-ups are still here, marked new on this visit", rows.slice(2).every(t => /ثبت‌نام/.test(t) && /تازه/.test(t)));
  check("who invited whom is said", /با دعوت: سارا رضایی/.test(await ev("return document.querySelector('.feed').innerText")));
  await shot("feed-390.png");
  await ev("document.querySelector('[data-act=ffilter][data-f=order]').click();" + T(400));
  check("the filter shows only orders", await ev("return document.querySelectorAll('.feed .row').length===1&&/سفارش/.test(document.querySelector('.feed .row').textContent)"));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(600));
  check("after the visit nothing is new", await ev("return !document.querySelector('.dhead .dico em')&&!document.querySelector('#nav [data-tab=feed] .nb')"));
  // a party finished the three steps toward VIP (the server writes vip_ready once): it shows up, waiting for the owner's own decision
  await post("/api/push", { changes: [{ c: "vip_ready", id: "vp1", d: { partyId: "vp1", name: "طرف آماده", ts: new Date().toISOString() } }] }, own);
  await sleep(1500);
  check("the menu counts the VIP notice as new", await ev("const b=document.querySelector('#nav [data-tab=feed] .nb');return !!b"));
  await ev("document.querySelector('#nav [data-tab=feed]').click();" + T(500));
  await ev("document.querySelector('[data-act=ffilter][data-f=vip]').click();" + T(400));
  check("the VIP filter shows the party that finished, waiting for the owner", await ev("const r=document.querySelectorAll('.feed .row');return r.length===1&&/طرف آماده/.test(r[0].textContent)&&/سه شرط VIP/.test(r[0].textContent)&&/منتظر تصمیم تو/.test(r[0].textContent)"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
