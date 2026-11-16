// A wholesale invoice shows the party's rial balance before it and after the money it moves (owner, 2026-11-01).
// node tests/rial.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3994";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8776);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-rial-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3994", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8776" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-rial-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9342", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9342/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8776/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // a party that owes 50,000,000 rials from an earlier retail invoice
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('p1').set({name:'همکار',kind:'customer',openR:50000000,openG:2});" + T(800));
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=p1]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=whole]').click();" + T(1200));
  check("the rial balance before is filled from the party", (await ev("return document.getElementById('w_rprev').value")).replace(/\D/g, "") !== "" && /۵۰٬۰۰۰٬۰۰۰|50,000,000|۵۰,۰۰۰,۰۰۰/.test(await txt("#x_rprev")) || /۵۰/.test(await txt("#x_rbal")), await txt("#x_rbal"));
  check("with no money moved, the final rial balance is shown and equals the one before", await vis("#x_rbal") && (await txt("#x_rbal")) === (await txt("#x_rprev")));
  // the party pays 20,000,000 rials in cash on this document
  await ev(set("#tx_ci", "20000000") + T(400));
  check("cash received is taken off: 30,000,000 owed", /۳۰٬?۰۰۰٬?۰۰۰|۳۰,۰۰۰,۰۰۰/.test(await txt("#x_rbal")) && /بدهکار/.test(await txt("#x_rbal")), await txt("#x_rbal"));
  check("the line «مانده ریالی قبلی» shows too", await vis("#x_rprev"));
  // and pays out 60,000,000 instead: Leon now owes 10,000,000
  await ev(set("#tx_ci", "") + set("#tx_co", "60000000") + T(400));
  check("cash paid out is added: 110,000,000 owed", /۱۱۰/.test(await txt("#x_rbal")) && /بدهکار/.test(await txt("#x_rbal")), await txt("#x_rbal"));
  await ev(set("#tx_co", "") + set("#tx_ci", "80000000") + T(400));
  check("more than owed turns it into credit: 30,000,000 بستانکار", /۳۰/.test(await txt("#x_rbal")) && /بستانکار/.test(await txt("#x_rbal")), await txt("#x_rbal"));
  // discounts: a rial discount lowers the rial side, a gram discount the grams (they never convert)
  await ev(set("#tx_ci", "") + set("#w_discr", "5000000") + T(400));
  check("a rial discount of 5,000,000 on a 50,000,000 debt leaves 45,000,000", /۴۵٬۰۰۰٬۰۰۰/.test(await txt("#x_rbal")) && /بدهکار/.test(await txt("#x_rbal")) && await vis("#x_dr"), await txt("#x_rbal"));
  await ev(set("#w_discr", "") + T(300));
  check("the discount line hides at zero", !(await vis("#x_dr")));
  await ev(set("#w_discg", "0.5") + T(400));
  check("a gram discount of 0.5 on a 2-gram debt leaves 1.5 owed", /۱٫۵/.test(await txt("#x_bal")) && /بدهکار/.test(await txt("#x_bal")) && await vis("#x_dg"), await txt("#x_bal"));
  await ev(set("#w_discg", "") + T(300));
  check("the gram side is untouched (2 grams before)", /۲/.test(await txt("#x_all")), await txt("#x_all"));
  check("retail payment inputs still go into an invoice's saved vals; the rial balance before does not", await ev("return document.querySelectorAll('#retail .rp').length===4&&document.querySelectorAll('.rp').length===4&&!document.querySelector('#w_rprev').classList.contains('rp')"));
  // retail: a gram discount is worth grams at this invoice's gold price
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=p1]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=retail]').click();" + T(1200));
  await ev(set("#retail .gp", "100000000") + set("#rt tbody tr .w", "2") + T(400));
  const before = await txt("#s_final");
  await ev(set("#r_discg", "0.5") + T(400));
  check("retail: a 0.5-gram discount at 100,000,000 a gram takes 50,000,000 off", /۱۵۰٬۰۰۰٬۰۰۰/.test(await txt("#s_final")) && /۲۰۰٬۰۰۰٬۰۰۰/.test(before), before + " -> " + (await txt("#s_final")));
  await ev(set("#r_disc", "10000000") + T(400));
  check("retail: and a rial discount on top: 140,000,000", /۱۴۰٬۰۰۰٬۰۰۰/.test(await txt("#s_final")), await txt("#s_final"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
