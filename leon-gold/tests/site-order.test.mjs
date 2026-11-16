// The site's order form (owner, 2026-11-14): a visitor's «ثبت سفارش» reaches the ledger as a new lead from «سایت».
// node tests/site-order.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
//
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

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8777);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-siteorder-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3997", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8777" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const call = async (p, body, token) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-siteorder-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9342", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9342/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8777/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;


try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='۹۹۹۹';document.getElementById('entryForm').requestSubmit();" + T(1800));
  check("signed in", await ev("return !document.getElementById('entry')&&window.__leonSync.info().on"));
  await ev("var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='بعداً');if(b)b.click();" + T(300));
  // a visitor sends the site's form (the public endpoint the site calls)
  const r = await call("/api/public/order", { name: "سارا رضایی", phone: "۰۹۱۲۱۲۳۴۵۶۷", what: "انگشتر", note: "سایز ۵۲", website: "" });
  check("the site's order is accepted", r.ok === true, JSON.stringify(r));
  await ev(T(3000));
  const home = await ev("return main.textContent");
  check("the home page lists it under «سفارش تازه»", /سفارش تازه/.test(home) && /سارا رضایی/.test(home) && /سایز ۵۲/.test(home));
  check("marked «از سایت»", await ev("return [...document.querySelectorAll('.row.lead')].some(r=>/سارا رضایی/.test(r.textContent)&&/از سایت/.test(r.textContent))"));
  check("with a call button to the visitor's number", await ev("return !!document.querySelector('.row.lead a[href=\"tel:09121234567\"]')"));
  check("and the count on «سفارشات» in the menu", (await ev("return document.querySelector('#nav [data-tab=orders] .nb')?.textContent||''")) === "۱");
  await shot("site-order-home-390.png");
  // «ثبت سفارش» turns it into an order with what was asked (no party yet: the owner picks one)
  await ev("document.querySelector('.row.lead [data-act=leadorder]').click();" + T(700));
  check("«ثبت سفارش» opens the order form with the request", /انگشتر/.test(await ev("return [...document.querySelectorAll('input,textarea')].map(i=>i.value).join(' ')")));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
