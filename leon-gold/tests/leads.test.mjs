// A customer orders a showcase piece from «حساب من»: the ledger says so, counts it on «سفارشات», lists it on the home page,
// and turns it into an order (owner, 2026-11-08).   node tests/leads.test.mjs   (offline build without -SyncUrl, ../leon-gold-server, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3987";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8770);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-leads-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3987", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8770" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-leads-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9328", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9328/json/version")).json(); } catch {} }
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
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // a customer with a «حساب من» login, and a piece on show
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('cu').set({name:'سادیار',kind:'customer',phone:'09120000000'});await db.collection('parties').doc('sp').set({name:'کارگاه نیک',kind:'supplier'});await db.collection('vitrin').doc('v1').set({name:'انگشتر سولیتر',code:'R12',show:true,stock:'order',weight:3.4,carat:750,supId:'sp',supName:'کارگاه نیک'});" + T(500) + "await window.__leonSync.now();" + T(900));
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  const call = async (p, body, t) => (await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  await call("/api/portal/login/set", { partyId: "cu", username: "sadyar", password: "pass1234" }, tok);
  const ct = (await call("/api/portal/login", { u: "sadyar", p: "pass1234" })).token;
  // the customer orders it from «حساب من»
  check("the customer's order is accepted", (await call("/api/portal/vitrin/order", { id: "v1", note: "سایز ۵۲" }, ct)).ok === true);
  await ev("await window.__leonSync.now();" + T(1200));
  const toastText = await ev("const t=document.getElementById('toast');return t&&!t.hidden?t.textContent:''");
  check("a message appears in the ledger", /سفارش تازه از «حساب من»/.test(toastText) && /سادیار/.test(toastText), toastText);
  check("«سفارشات» in the menu shows the count", await ev("const b=document.querySelector('#nav [data-tab=orders] .nb');return !!b&&b.textContent==='۱'"));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(800));
  const home = await ev("const s=document.querySelector('.leads');return s?s.innerText.replace(/\\s+/g,' '):''");
  check("the home page lists it with the piece and the note", /سادیار/.test(home) && /انگشتر سولیتر/.test(home) && /سایز/.test(home), home);
  // it waits 120 s for the owner: a countdown and «تایید سفارش» (owner, 2026-11-09)
  check("it waits for confirmation, with a countdown", /منتظر تایید شما/.test(home) && /ثانیه/.test(home) && await ev("return !!document.querySelector('[data-act=leadok]')"), home);
  await ev("document.querySelector('[data-act=leadok]').click();" + T(2500));
  const okLead = (await call("/api/pull?since=0", null, (await call("/api/login", { u: "مالک", p: "9999" })).token)).changes.filter(x => x.c === "crm_leads").pop();
  check("«تایید سفارش» confirms it for the buyer", okLead && okLead.d.status === "confirmed", JSON.stringify(okLead && okLead.d.status));
  check("the buyer's page hears it", (await call("/api/portal/vitrin/order/" + okLead.id, null, ct)).status === "confirmed");
  // turned into an order: the form is filled from it; saving marks it handled
  await ev("document.querySelector('[data-act=leadorder]').click();" + T(900));
  check("«ثبت سفارش» opens the order form for that customer and piece", await ev("return document.getElementById('of_party').value==='cu'&&/انگشتر سولیتر/.test(document.querySelector('#oitems input').value)&&/سایز/.test(document.getElementById('of_note').value)"));
  check("its supplier, weight and purity come from the showcase piece", await ev("return document.querySelector('#oitems select[data-k=supId]').value==='sp'&&/^(3|۳).(4|۴)$/.test(document.querySelector('#oitems input[data-k=weight]').value)"), await ev("return document.querySelector('#oitems input[data-k=weight]').value"));
  await ev("document.querySelector('[data-act=saveorder]').click();" + T(1500));
  await ev("await window.__leonSync.now();" + T(900));
  const pulled = (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes;
  const ord = pulled.filter(x => x.c === "orders" && x.d)[0], lead = pulled.filter(x => x.c === "crm_leads" && x.d).pop();
  check("the order is saved for the customer, with the piece's supplier", !!ord && ord.d.partyId === "cu" && ord.d.items[0].supId === "sp", JSON.stringify(ord && [ord.d.partyId, ord.d.items[0].supId]));
  check("the lead is marked handled, with its order", !!lead && lead.d.status === "talking" && lead.d.orderId === ord.id, JSON.stringify(lead && { s: lead.d.status, o: lead.d.orderId }));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(700));
  check("and it leaves the list and the menu count", await ev("return !document.querySelector('.leads')&&!document.querySelector('#nav [data-tab=orders] .nb')"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
