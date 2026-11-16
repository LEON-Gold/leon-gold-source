// «آبشده و سند موقت» (owner, 2026-11-16): a colleague's order from «حساب من», approved in the ledger, placed at the stand-in seller,
// into «سند موقت», and the next day a wholesale invoice filled from it. node tests/melt.test.mjs (built without -SyncUrl, server beside, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = fs.realpathSync(path.join(root, "..", "leon-gold-server", "server.mjs"));   // real path: the server starts only when run as itself (a worktree may reach it by a link)
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3992";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8774);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-melt-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3992", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8774", MELT_SUPPLIER: "mock", MELT_WAIT_S: "90" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-melt-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9340", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9340/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8774/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);

const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;
const call = async (p, body, token) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('co1').set({name:'همکار آبشده',kind:'customer',biz:'melt'});"
    + "await db.collection('settings').doc('melt').set({on:true,msg:'قوانین',items:{m1:{on:true,m:50000},c1:{on:true,m:1000000}}});" + T(1500));
  const owner = (await call("/api/login", { u: "مالک", p: "9999" })).token;
  await call("/api/portal/login/set", { partyId: "co1", username: "hamkar", password: "gold1234" }, owner);
  const co = (await call("/api/portal/login", { u: "hamkar", p: "gold1234" })).token;
  const pull = async c => (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + owner } })).json()).changes.filter(x => x.c === c && x.d).map(x => ({ ...x.d, id: x.id }));
  const prices = Object.fromEntries((await call("/api/portal/melt", null, co)).items.map(x => [x.k, x]));
  check("the colleague sees the price with the margin", prices.m1.buy === 1061400000 + 500000, JSON.stringify(prices.m1));
  // 1. a melt buy: approved in the ledger
  const o1 = (await call("/api/portal/melt/order", { k: "m1", side: "buy", qty: "2.5", unit: prices.m1.buy }, co)).order;
  check("order waiting", o1 && o1.status === "waiting", JSON.stringify(o1));
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(3500));
  check("every page: the bar says an order waits", await ev("const b=document.getElementById('meltBar');return !!b&&!b.hidden&&/منتظر تایید/.test(b.textContent)"));
  await ev("document.getElementById('meltBar').click();" + T(1500));
  let t = await ev("return document.getElementById('main').textContent");
  check("the page lists it with its countdown", /همکار آبشده/.test(t) && /خرید همکار/.test(t) && /۲٫۵ مثقال/.test(t) && /ثانیه/.test(t), t.slice(0, 400));
  await ev("document.querySelector('[data-act=meltok][data-id=" + o1.id + "]').click();" + T(2500));
  check("approved: done for the colleague", (await call("/api/portal/melt/order/" + o1.id, null, co)).order.status === "done");
  t = await ev("return document.getElementById('main').textContent");
  check("in «سند موقت»", /سند موقت/.test(t) && /۲٫۵ مثقال/.test(t) && /ثبت/.test(t));
  // 2. the next day: «ثبت» fills a wholesale invoice; saving it marks the document
  const temp1 = (await pull("tempdocs")).find(x => x.order === o1.id);
  await ev("document.querySelector('[data-act=meltreg]').click();" + T(1500));
  check("prefilled: sale of gold by amount, the exact total", await ev("return document.getElementById('tx_t').value==='sell'&&document.getElementById('tx_m').value==='a'&&document.getElementById('tx_u').value===''") && (await ev("return window.LGW&&window.LGW.ta")) === temp1.total, String(await ev("return window.LGW&&window.LGW.ta")) + " / " + temp1.total);
  await ev("document.getElementById('saveInv').click();" + T(2000));
  let inv = (await pull("invoices")).find(x => x.trade && x.trade.note && x.trade.note.includes("سند موقت"));
  check("saved: the party owes the total in rial, credited the gold", inv && inv.deltaR === temp1.total && inv.trade.type === "sell" && inv.trade.amount === temp1.total && inv.deltaG < 0, JSON.stringify(inv && { deltaR: inv.deltaR, deltaG: inv.deltaG, trade: inv.trade }));
  check("the temporary document is registered with that invoice", (await pull("tempdocs")).find(x => x.order === o1.id).reg !== "");
  // 3. a coin sell
  const o2 = (await call("/api/portal/melt/order", { k: "c1", side: "sell", qty: "3", unit: prices.c1.sell }, co)).order;
  await ev("document.querySelector('#nav [data-tab=melt]').click();" + T(3500));
  await ev("document.querySelector('[data-act=meltok][data-id=" + o2.id + "]').click();" + T(2500));
  const temp2 = (await pull("tempdocs")).find(x => x.order === o2.id);
  check("coin trade in «سند موقت»", temp2 && temp2.fx === "cn" && temp2.qty === 3 && temp2.side === "sell");
  await ev("document.querySelector('#nav [data-tab=home]').click();" + T(300) + "document.querySelector('#nav [data-tab=melt]').click();" + T(1200) + "document.querySelector('[data-act=meltreg]').click();" + T(1500));
  check("prefilled: purchase of 3 coins at the colleague's price", await ev("return document.getElementById('tx_t').value==='buy'&&document.getElementById('tx_u').value==='cn'") && (await ev("return window.LGW.ta")) === temp2.total);
  await ev("document.getElementById('saveInv').click();" + T(2000));
  inv = (await pull("invoices")).find(x => x.trade && x.trade.u === "cn");
  check("saved: Leon owes the rial, the party owes the 3 coins", inv && inv.deltaR === -temp2.total && inv.deltaG === 0 && inv.fx.length === 1 && inv.fx[0].u === "cn" && inv.fx[0].n === 3 && inv.fx[0].dir === "out" && inv.fx[0].tr === 1, JSON.stringify(inv && { deltaR: inv.deltaR, deltaG: inv.deltaG, fx: inv.fx }));
  // the colleague's card: rial owed = melt total − coin total; 3 coins owed by the party
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(500) + "document.querySelector('[data-act=party][data-id=co1]').click();" + T(900));
  t = await ev("return document.getElementById('main').textContent");
  const net = temp1.total - temp2.total, faN = n => n.toLocaleString("fa-IR");
  check("the colleague's card: rial and coins", t.includes(faN(Math.abs(net))) && /سکه طرح جدید/.test(t), t.slice(0, 500));
  // 4. reopened, unlocked and saved again: the coin row is not doubled
  await ev("document.querySelector('#nav [data-tab=invoices]').click();" + T(1200));
  await ev("document.querySelector('[data-act=inv][data-id=\"" + inv.id + "\"]').click();" + T(1200));
  check("reopened: the piece is back", await ev("return document.getElementById('tx_u').value==='cn'&&document.getElementById('tx_t').value==='buy'"));
  await ev("const u=document.querySelector('[data-act=unlockinv]');if(u)u.click();" + T(600) + "const y=document.querySelector('.modal [data-y]');if(y)y.click();" + T(600) + "document.getElementById('saveInv').click();" + T(2000));
  inv = (await pull("invoices")).find(x => x.id === inv.id);
  check("saved again: still one coin row", inv.fx.length === 1 && inv.deltaR === -temp2.total, JSON.stringify({ fx: inv.fx, deltaR: inv.deltaR }));
  check("no page errors", !errors.length, errors.join(" | "));
} catch (e) { console.log("ERR", e.stack); fails++; }
finally { ws.close(); chrome.kill(); srv.kill(); page.close(); }
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
