// Invoice rows from products: a picker with photos (in stock first) fills the row, the weight from stock; and personal orders
// to a supplier for the owner himself (owner, 2026-11-08).   node tests/picker.test.mjs   (offline build without -SyncUrl, ../leon-gold-server, Chrome)
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

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8768);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-pick-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3985", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8768" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-pick-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9330", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9330/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8768/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // a ring in stock (2 pieces, 8.4 grams together, no «وزن هر عدد» on its card), a bracelet with only a card weight, a supplier
  await ev("const db=await window.claude.use('db');await db.collection('products').doc('pr').set({code:'101',name:'انگشتر سولیتر',carat:750,ajrat:12,openQ:2,openG:8.4});await db.collection('products').doc('pb').set({code:'102',name:'دستبند',carat:750,unitW:5.5,openQ:0,openG:0});await db.collection('parties').doc('cu').set({name:'مشتری',kind:'customer'});await db.collection('parties').doc('sp').set({name:'کارگاه',kind:'supplier'});" + T(900));
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=cu]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=whole]').click();" + T(1200));
  const pick = () => ev("const b=[...document.querySelectorAll('#form button')].find(x=>/افزودن از کالاها/.test(x.textContent));b.click();" + T(500) + "return !!document.querySelector('.ppk')");
  check("«+ افزودن از کالاها» opens the picker", await pick());
  check("it lists every product, the one in stock first", await ev("return [...document.querySelectorAll('.ppk [data-p]')].map(b=>b.dataset.p).join(',')==='pr,pb'"));
  await ev("document.querySelector('.ppk [data-f=in]').click();" + T(200));
  check("«فقط موجود» leaves only what is in stock", await ev("return [...document.querySelectorAll('.ppk [data-p]')].map(b=>b.dataset.p).join(',')==='pr'"));
  await ev("document.querySelector('.ppk [data-p=pr]').click();" + T(700));
  const row0 = k => ev("const tr=document.querySelectorAll('#wt tbody tr')[0];return tr.querySelector(" + JSON.stringify(k) + ").value");
  check("the ring fills the row: its name", /انگشتر سولیتر/.test(await row0("td:nth-child(2) input")), await row0("td:nth-child(2) input"));
  check("its weight comes from stock (8.4 g over 2 pieces = 4.2 for one)", /۴٫۲|4\.2|۴\/۲/.test(await row0(".w")), await row0(".w"));
  check("and its wage", /۱۲|12/.test(await row0(".aj")), await row0(".aj"));
  check("the picker closed", await ev("return !document.querySelector('.ppk')"));
  await pick(); await ev("document.querySelector('.ppk [data-p=pb]').click();" + T(700));
  const row1 = k => ev("const tr=document.querySelectorAll('#wt tbody tr')[1];return tr.querySelector(" + JSON.stringify(k) + ").value");
  check("the next pick goes to the next empty row, with the card's weight when stock has none", /دستبند/.test(await row1("td:nth-child(2) input")) && /۵٫۵|5\.5|۵\/۵/.test(await row1(".w")), await row1(".w"));
  // a personal order: from the supplier, for the owner himself
  // leaving the unsaved invoice asks first; say yes
  await ev("document.querySelector('#nav [data-tab=orders]').click();" + T(500) + "const y=[...document.querySelectorAll('.modal button')].find(b=>/خروج/.test(b.textContent));if(y)y.click();" + T(700));
  await ev("document.querySelector('[data-act=newself]').click();" + T(700));
  check("«+ سفارش شخصی» opens the form set to personal", await ev("return document.getElementById('of_party').value==='__self'"));
  await ev("const i=document.querySelector('#oitems input');i.value='زنجیر';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));" + T(300));
  await ev("const s=document.querySelector('#oitems select');if(s){s.value='sp';s.dispatchEvent(new Event('change',{bubbles:true}))}" + T(200));
  await ev("document.querySelector('[data-act=saveorder]').click();" + T(1200));
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const ord = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "orders" && x.d)[0];
  check("saved as personal, with no customer", !!ord && ord.d.self === true && ord.d.partyId === "" && /شخصی/.test(ord.d.partyName), JSON.stringify(ord && { self: ord.d.self, partyId: ord.d.partyId, name: ord.d.partyName }));
  await ev("document.querySelector('[data-act=ofilter][data-f=self]').click();" + T(500));
  check("the «شخصی» filter shows it, marked", /شخصی/.test(await ev("return document.querySelector('.list').textContent")) && await ev("return document.querySelectorAll('.list [data-act=order]').length===1"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
