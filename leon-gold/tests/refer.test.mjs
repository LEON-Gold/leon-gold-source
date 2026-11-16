// invite codes (owner, 2026-11-09): a sign-up through a customer's code is marked as its referral; the owner sets the
// referrer's share; the ledger shows it: 100 g sold at 1% wage (bought at 0) = 1 g net profit, at 20% = 0.200 g. node tests/refer.test.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3985";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8769);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-ref-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3985", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8769" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-ref-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9335", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9335/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8769/" }, sid); await sleep(2000);
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
  const inv = await post("/api/portal/invite", null, sara.token);
  check("a customer has an invite code", /^[A-Z2-9]{6}$/.test(inv.code || ""), JSON.stringify(inv));
  const mina = await post("/api/portal/signup", { fullName: "مینا احمدی", mobile: "09127654321", nationalId: "0012345601", biz: "retail", username: "mina.a", password: "Gold1405", ref: inv.code });
  check("a friend signs up with it", !!mina.token, JSON.stringify(mina));
  check("the referrer sees one joined", (await post("/api/portal/invite", null, sara.token)).joined === 1);
  const own = (await post("/api/login", { u: "مالک", p: "9999" })).token;
  const parties = (await post("/api/pull?since=0", null, own)).changes.filter(c => c.c === "parties");
  const sid0 = parties.find(c => c.d.name === "سارا رضایی").id, mid = parties.find(c => c.d.name === "مینا احمدی").id;
  check("the friend's card says who brought it", parties.find(c => c.id === mid).d.refBy === sid0);
  // Mina buys 100 g at 1% wage (bought at 0), and one line with no purchase wage known
  const r = await post("/api/push", { changes: [{ c: "invoices", id: "iv1", d: { kind: "whole", partyId: mid, ts: new Date().toISOString(), items: [{ desc: "زنجیر", weight: 100, carat: 750, ajrat: 1, costAj: 0 }, { desc: "پلاک", weight: 5, carat: 750, ajrat: 3 }] } }] }, own);
  check("the sale is in", r.status === 200, JSON.stringify(r));
  await ev("window.__leonSync.now();" + T(2500));
  const openParty = async id => ev("document.querySelector('#nav [data-tab=parties]').click();" + T(700) + "document.querySelector('#lst [data-id=" + JSON.stringify(id) + "]').click();" + T(800));
  await openParty(sid0);
  const refsec = async () => (await ev("const s=document.getElementById('refsec');return s?s.innerText:''")).replace(/\s+/g, " ");
  check("no share set yet: it says so", /درصد سهم تعیین نشده/.test(await refsec()) && /مینا احمدی/.test(await refsec()), await refsec());
  await ev("document.querySelector('[data-act=editparty]').click();" + T(700) + set("#pf_refpct", "۲۰") + "document.querySelector('[data-act=saveparty]').click();" + T(1500));
  await openParty(sid0);
  const t = await refsec();
  check("20% of 1 g = 0.200 g", /۲۰٪/.test(t) && /جمع سهم ۰٫۲ گرم/.test(t), t);
  check("Leon's net profit on the friend is 1 g", /سود خالص لئون: ۱ گرم/.test(t), t);
  check("the line with no purchase wage is left out and said", /۱ ردیف بی‌اجرت خرید/.test(t), t);
  await shot("refer-party-390.png");
  await openParty(mid);
  check("the friend's page names its referrer", /معرفِ این شخص: سارا رضایی/.test(await refsec()), await refsec());
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(800));
  check("the referrers at a glance on «طرف‌حساب‌ها»", await ev("const s=document.querySelector('.refsum');return !!s&&/سارا رضایی/.test(s.textContent)&&/۰٫۲ گرم/.test(s.textContent)"));
  check("the sign-up says whose invite it came with", /با دعوت: سارا رضایی/.test(await ev("return document.getElementById('main').innerText")));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
