// «#view»: «حساب من» shows a party's invoice on the ledger's own A4 sheet, sent from the page above by postMessage (owner, 2026-11-08).
// node tests/view.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

// a wholesale invoice as the portal sends it: the sheet's saved inputs and parts, nothing else
const inv = { kind: "whole", doc: "pd", no: "42", date: "۱۴۰۵/۰۷/۳۰", rows: 8, tax: "۰", gp: 78000000, rets: [2], disc2: ["", "", ""], rprev: ["", "dr"],
  vals: ["۱۴۰۵/۰۷/۳۰", "۴۲", "۱۴۰۵/۰۸/۲۵", "pd", "مشتری نمونه", "گالری نمونه", "09120000000", "تهران",
    "النگو تراش", "۲", "۱۲٫۴۰", "", "۳", "دستبند کارتیه", "۱", "۶٫۸", "", "۵", "انگشتر ساده", "۱", "۲٫۱", "۷۴۰", "",
    ...Array(25).fill(""), "۷۸٬۰۰۰٬۰۰۰", "", "۱٫۲۵", "cr", "dl", "۲", "cr", "", "cr", "", "نمونه‌ی فاکتور"],
  gold: [{ type: "ab", weight: 3, purity: "۷۴۰", lab: "آزمایشگاه نمونه" }], goldDir: "cr",
  trade: { type: "sell", mode: "w", w: 5, gp: 78000000, amount: 390000000, note: "", cin: 200000000, cout: 0 },
  hav: { partyId: "h", partyName: "آبشده‌فروش", w: 1, dir: "out" } };
const parent = `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="/app/#view" style="border:0;width:100vw;height:100vh"></iframe>
<script>window.msgs=[];addEventListener('message',e=>{window.msgs.push(e.data);if(e.data&&e.data.leonView==='ready')f.contentWindow.postMessage({leonInv:${JSON.stringify(inv)}},location.origin)})</script>`;
const page = http.createServer((q, r) => { if (q.url.startsWith("/app/sw.js")) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(q.url.startsWith("/app/") ? html : parent); }).listen(8767);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-view-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9331", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9331/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8767/" }, sid); await sleep(3500);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const inF = js => ev(`const d=document.getElementById('f').contentDocument,w=document.getElementById('f').contentWindow;${js}`);

try {
  check("the sheet says it is shown", await ev("return window.msgs.some(m=>m.leonView==='shown')"), JSON.stringify(await ev("return window.msgs")));
  check("only the A4 preview: no splash, ledger header, menu or pages", await inF("return !d.getElementById('splash')&&getComputedStyle(d.querySelector('.top')).display==='none'&&d.getElementById('main').children.length===0&&d.getElementById('pvfoot').classList.contains('on')"));
  // (owner, 2026-11-14) the A5 pages are shown, made from the sheet: the first carries the party and the rows
  check("the wholesale invoice on A5 pages, with the party and rows", await inF("const s=d.querySelector('#pages>.sheet.a5');return !!s&&d.getElementById('whole').hidden&&s.querySelector('.cust input').value==='مشتری نمونه'&&s.querySelector('#wt tbody tr td:nth-child(2) input').value==='النگو تراش'"));
  check("the returned row is marked", await inF("return d.querySelectorAll('#wt tbody tr')[2].dataset.ret==='1'"));
  const bal = await inF("return d.getElementById('x_bal').textContent");
  check("the final gram balance is the ledger's own sum (20.734 − 4.96 − 5 + 1)", /۱۱٫۷۷۴|۱۱\/۷۷۴|۱۱.۷۷۴/.test(bal) && /بدهکار/.test(bal), bal);
  check("the transfer names its account", /آبشده‌فروش/.test(await inF("return d.getElementById('x_hv').textContent")));
  check("the gold trade and the rial balance", /بدهکار/.test(await inF("return d.getElementById('x_rbal').textContent")) && /۱۹۰/.test(await inF("return d.getElementById('x_rbal').textContent")));
  check("the invoice terms are on it", /اشتباه از طرفین/.test(await inF("return d.getElementById('whole').textContent")));
  check("nothing is editable", await inF("return [...d.querySelectorAll('#whole input')].every(e=>e.readOnly)"));
  check("no service worker for the ledger here", await inF("return !(await w.navigator.serviceWorker.getRegistration())"));
  await inF("d.getElementById('pvClose').click()"); await sleep(200);
  check("«بستن» tells the page above", await ev("return window.msgs.some(m=>m.leonView==='close')"));
} catch (e) { check("crashed: " + e.message, false); }
ws.close(); chrome.kill(); page.close(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
