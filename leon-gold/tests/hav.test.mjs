// A transfer order (حواله) on a wholesale invoice: paid through a third party's account, it settles this party and moves the third party the other way (owner, 2026-11-02).
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
const API = "http://127.0.0.1:3984";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8766);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-hav-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3984", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8766" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-hav-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9332", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9332/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8766/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
const txt = sel => ev(`return document.querySelector(${JSON.stringify(sel)}).textContent`);
const vis = sel => ev(`return getComputedStyle(document.querySelector(${JSON.stringify(sel)}).closest('label')).display!=='none'`);
const set = (sel, v) => `{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  // Leon keeps 100 grams with the bullion dealer; it buys a 10-gram piece from the neighbour and pays by a transfer from that account
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('ab').set({name:'آبشده‌فروش',kind:'supplier',openG:100});await db.collection('parties').doc('nb').set({name:'همسایه',kind:'supplier'});" + T(800));
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(600) + "document.querySelector('[data-act=party][data-id=nb]').click();" + T(600) + "document.querySelector('[data-act=new][data-k=whole]').click();" + T(1200));
  await ev(set("#w_doc", "rc") + set("#wt tbody tr .w", "10") + set("#wt tbody tr .c", "750") + T(400));
  check("the purchase alone: the neighbour is owed 10 grams", /۱۰/.test(await txt("#x_bal")) && /بستانکار/.test(await txt("#x_bal")), await txt("#x_bal"));
  check("the transfer's account lists everyone but the neighbour", await ev("return [...document.querySelectorAll('#w_hvp option')].map(o=>o.value).join(',')===',ab'"));
  check("no transfer line at zero", !(await vis("#x_hv")));
  await ev(set("#w_hv", "10") + T(300));
  await ev("document.getElementById('saveInv').click();" + T(900));
  const pulled = async () => (await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json()).changes.filter(x => x.c === "invoices" && x.d);
  const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
  check("a transfer without its account is not saved", !(await pulled()).length);
  await ev(set("#w_hvp", "ab") + T(400));
  check("with the transfer the neighbour is settled", /تسویه|^۰/.test(await txt("#x_bal")), await txt("#x_bal"));
  check("the transfer line names the account", await vis("#x_hv") && /آبشده‌فروش/.test(await txt("#x_hv")), await txt("#x_hv"));
  await ev("document.getElementById('saveInv').click();" + T(1200));
  const inv = (await pulled()).find(x => x.d.partyId === "nb");
  check("saved with the transfer on it", !!inv && inv.d.hav && inv.d.hav.partyId === "ab" && inv.d.hav.w === 10 && inv.d.hav.dir === "out" && Math.abs(inv.d.deltaG) < 0.0005, JSON.stringify(inv && inv.d.hav));
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(800));
  const row = id => ev("return document.querySelector('[data-act=party][data-id=" + id + "]').textContent");
  check("the dealer shows 90 (Leon's gold there went down by 10)", /۹۰/.test(await row("ab")), await row("ab"));
  check("the neighbour is settled", !/۱۰/.test(await row("nb")), await row("nb"));
  await ev("document.querySelector('[data-act=party][data-id=ab]').click();" + T(800));
  check("the dealer's statement shows the transfer", /حواله از حساب لئون به همسایه/.test(await ev("return document.body.textContent")));
  await ev("document.querySelector('[data-act=inv][data-id=" + inv.id + "]').click();" + T(1200));
  check("reopened from the dealer's statement, the transfer is filled back in", await ev("return document.getElementById('w_hvp').value==='ab'&&/10|۱۰/.test(document.getElementById('w_hv').value)"));
  check("and printed on it", await vis("#x_hv") && /آبشده‌فروش/.test(await txt("#x_hv")), await txt("#x_hv"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
