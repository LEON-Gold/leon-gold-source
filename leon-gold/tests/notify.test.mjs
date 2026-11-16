// Notifications: right after signing in, a sheet asks to turn them on (not a switch in the profile; owner, 2026-11-09).
// node tests/notify.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
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

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8767);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-nf-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3985", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8767" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-nf-chrome-"));
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

const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(2500));
  const sheet = () => ev("const m=document.getElementById('nfSheet');return m?m.innerText.replace(/\s+/g,' '):''");
  check("right after signing in, a sheet asks to turn notifications on", /اعلان‌های دفتر را روشن کن/.test(await sheet()) && /روشن کن/.test(await sheet()), await sheet());
  await shot("notify-sheet-390.png");
  await ev("document.querySelector('[data-nf=later]').click();" + T(300));
  check("«بعداً» closes it", !(await sheet()));
  await ev("document.querySelector('#nav [data-tab=orders]').click();" + T(1500));
  check("and it does not come back while still signed in", !(await sheet()));
  // a ledger user: it comes back at the next sign-in
  await ev("document.querySelector('#nav [data-tab=users]').click();" + T(700));
  await ev("[...document.querySelectorAll('[data-act=pinset]')].find(b=>!b.dataset.u).click();" + T(400));
  await ev("const f=(i,v)=>{document.getElementById(i).value=v};f('pnU','علی');f('pn1','1234');f('pn2','1234');document.querySelector('.modal form').requestSubmit();" + T(1500));
  await ev("const s=document.getElementById('nfSheet');if(s)s.remove();document.getElementById('lockBtn').click();" + T(800));
  check("locked: no sheet over the sign-in", !(await sheet()));
  await ev("document.getElementById('gateUser').value='علی';document.getElementById('gatePin').value='1234';document.getElementById('gateForm').requestSubmit();" + T(2000));
  check("signing in again brings it back", /روشن کن/.test(await sheet()), await sheet());
  // turning on where the device cannot (here: no service worker) says so instead of hanging
  await send("Browser.grantPermissions", { permissions: ["notifications"], origin: "http://127.0.0.1:8767" });
  await ev("document.querySelector('[data-nf=on]').click();" + T(1500));
  check("a failure is said on the sheet", /روشن نشد/.test(await sheet()), await sheet());
  // the server side: the key and a subscription for this ledger user
  const key = await ev("return (await window.__leonSync.api('/api/notify/key')).key");
  check("the server gives this device its push key", typeof key === "string" && key.length > 80);
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
