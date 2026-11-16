// A new order reaches an open ledger at once: the ledger keeps /api/wait open at the server (owner, 2026-11-09).
// node tests/hav.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3988";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8770);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-fast-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3988", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8770" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-fast-chrome-"));
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

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(3000));
  await ev("const s=document.getElementById('nfSheet');if(s)s.remove();");
  const call = async (p, body, t) => (await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const ot = (await call("/api/login", { u: "مالک", p: "9999" })).token;
  await call("/api/push", { changes: [{ c: "parties", id: "c1", d: { name: "سادیار", kind: "customer" } }, { c: "vitrin", id: "v1", d: { name: "انگشتر", weight: 3, show: true } }] }, ot);
  await call("/api/portal/login/set", { partyId: "c1", username: "sadyar", password: "pass1234" }, ot);
  const ct = (await call("/api/portal/login", { u: "sadyar", p: "pass1234" })).token;
  await sleep(4000); // the ledger idle, its request waiting at the server
  const t0 = Date.now();
  await call("/api/portal/vitrin/order", { id: "v1", note: "" }, ct);
  let ms = -1;
  for (let i = 0; i < 60; i++) { if (await ev("return /سادیار/.test((document.querySelector('.leads')||{}).textContent||'')||/سفارش تازه/.test((document.getElementById('toast')||{}).textContent||'')")) { ms = Date.now() - t0; break; } await sleep(100); }
  check("a new order shows in the ledger within 3 seconds (not 20)", ms >= 0 && ms < 3000, ms + " ms");
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {} }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
