// «تحلیل بازار» (owner, 2026-11-10): gold and dollar live, their charts and the analysis. Needs the internet (tgju and the
// price feed). node tests/market.test.mjs   (THEME=dark for the dark screenshots)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3983";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8771);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-mk-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3983", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8771" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-mk-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9337", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9337/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8771/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
try {
  if (process.env.THEME) { await ev("localStorage.setItem('leon-theme'," + JSON.stringify(process.env.THEME) + ")"); await send("Page.navigate", { url: "http://127.0.0.1:8771/" }, sid); await sleep(2000); }
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(2500));
  await ev("const s=document.getElementById('nfSheet');if(s)s.remove();");
  check("the home page has the way in", await ev("return !!document.querySelector('.dmk')"));
  await ev("document.querySelector('#nav [data-tab=market]').click();" + T(9000));
  const txt = (await ev("return document.getElementById('main').innerText")).replace(/\s+/g, " ");
  check("gold and dollar now", /طلای ۱۸ عیار · هر گرم [۰-۹٬,]+/.test(txt) && /دلار آزاد تهران [۰-۹٬,]+/.test(txt), txt.slice(0, 300));
  check("the analysis is written", await ev("return document.querySelectorAll('.me-li').length>=12&&!!document.querySelector('.me-hero h2')"), txt.slice(300, 900));
  check("four charts (gold, dollar, premium, ounce) with their tools and RSI", await ev("return document.querySelectorAll('.me-fig').length===4&&document.querySelectorAll('.me-m20').length>=2&&document.querySelectorAll('.me-rsi').length===3&&!!document.querySelector('.me-bb')&&!!document.querySelector('.me-res')"));
  check("the premium in rial and in ounce", /ارزش جهانی هر گرم/.test(await ev("return document.querySelector('.me-reading').innerText")) && /انس تهران|به انس/.test(await ev("return document.getElementById('main').innerText")));
  await ev("document.querySelector('.me-fig[data-kind=gold] [data-me-tool=reg]').click();" + T(400));
  check("a tool switches on: the trend channel on gold", await ev("return !!document.querySelector('.me-gold .me-reg')"));
  await ev("const s=document.querySelector('.me-fig svg'),b=s.getBoundingClientRect();s.dispatchEvent(new PointerEvent('pointermove',{clientX:b.left+b.width/2,clientY:b.top+20,bubbles:true}));" + T(200));
  check("a finger on the chart reads the day", /تومان/.test(await ev("return document.querySelector('.me-read').textContent")));
  await shot("market-" + (process.env.THEME || "light") + "-1.png");
  await ev("document.querySelector('[data-me-range=\"365\"]').click();" + T(500) + "document.querySelectorAll('.me-fig')[0].scrollIntoView();" + T(300));
  check("a year of history", await ev("return document.querySelector('.me-l').getAttribute('d').split('L').length>200"));
  await shot("market-" + (process.env.THEME || "light") + "-2.png");
  // currencies and coins (owner, 2026-11-16): a row each, a forecast for every one, a row opens to its chart and reading
  check("currencies and coins listed", await ev("return document.querySelectorAll('.me-xs [data-me-x]').length>=7"), await ev("return [...document.querySelectorAll('.me-xn')].map(e=>e.textContent).join('، ')"));
  check("a 30-day outlook on each row and in each gold card", await ev("return document.querySelectorAll('.me-xf').length===document.querySelectorAll('.me-xs [data-me-x]').length&&document.querySelectorAll('.me-reading .me-fc').length>=4"));
  await ev("document.querySelector('[data-me-x=\"sekee\"]').click()"); await sleep(400);
  check("a coin opens: chart, bubble and forecast", await ev("const b=document.querySelector('.me-x.open');return !!(b&&b.querySelector('.me-fig svg')&&/حباب سکه/.test(b.textContent)&&/پیش‌بینی ۳۰ روز/.test(b.textContent))"));
  await shot("market-x.png");
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
