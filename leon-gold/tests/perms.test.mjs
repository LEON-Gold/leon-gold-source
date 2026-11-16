// Limits on ledger users: the owner ticks the sections a user may open; that user sees and opens only those, never «ورود و کاربران»
// (owner, 2026-11-08).   node tests/perms.test.mjs   (offline build without -SyncUrl, ../leon-gold-server, Chrome)
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

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8771);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-perms-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3988", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8771" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-perms-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9327", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9327/json/version")).json(); } catch {} }
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

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(1800));
  const go = t => ev("document.querySelector('#nav [data-tab=" + t + "]').click();" + T(700));
  const addUser = async (u, pin, first) => {
    await go("users");
    await ev("[...document.querySelectorAll('[data-act=pinset]')].find(b=>!b.dataset.u).click();" + T(400));
    await ev("const f=(i,v)=>{document.getElementById(i).value=v};f('pnU'," + JSON.stringify(u) + ");f('pn1','" + pin + "');f('pn2','" + pin + "');document.querySelector('.modal form').requestSubmit();" + T(1200));
  };
  // the owner's own user first, then a shop assistant
  await addUser("علی", "1234", true);
  await addUser("شاگرد", "5678", false);
  // passwords set now are kept the slow way (PBKDF2), and the server lets the new device in with them
  { const tok = (await (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
    await sleep(1500);
    const pulled = await (await fetch(API + "/api/pull?since=0", { headers: { Authorization: "Bearer " + tok } })).json();
    const lock = pulled.changes.filter(c => c.c === "settings" && c.id === "lock").pop();
    const us = lock && lock.d.users || [];
    check("new passwords are PBKDF2 (kdf p2), 64 hex", us.length === 2 && us.every(x => x.kdf === "p2" && /^[0-9a-f]{64}$/.test(x.hash)), JSON.stringify(us.map(x => [x.u, x.kdf])));
    check("the server signs a device in with one", (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "شاگرد", p: "5678" }) })).status === 200);
    check("and not with a wrong one", (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "شاگرد", p: "5679" }) })).status === 401); }
  check("adding a user opens its limits straight away", await ev("return !!document.querySelector('.pmbox')&&/شاگرد/.test(document.querySelector('.pmbox').textContent)"));
  // only invoices and orders
  await ev("const all=document.getElementById('pmAll');all.click();" + T(100) + "document.querySelector('.pm[value=invoices]').click();document.querySelector('.pm[value=orders]').click();document.querySelector('.pmbox').requestSubmit();" + T(1200));
  const rows = await ev("return [...document.querySelectorAll('#secUsers .row')].map(r=>r.innerText.replace(/\\s+/g,' '))");
  check("the assistant is shown as limited to 2 sections", rows.some(r => /شاگرد/.test(r) && /محدود/.test(r) && /۲ بخش/.test(r)), JSON.stringify(rows));
  check("no «محدودیت» button on your own user", await ev("return [...document.querySelectorAll('[data-act=uperm]')].map(b=>b.dataset.u).join(',')==='شاگرد'"));
  // the assistant signs in on the lock screen
  await ev("document.getElementById('lockBtn').click();" + T(800));
  const signIn = async (u, pin) => ev("document.getElementById('gateUser').value=" + JSON.stringify(u) + ";document.getElementById('gatePin').value='" + pin + "';document.getElementById('gateForm').requestSubmit();" + T(1500));
  await signIn("شاگرد", "5678");
  // the numeric password a manager gave: the assistant makes its own straight away, letters allowed
  check("signed in with the manager's password, it is asked to make its own", await ev("return !!document.getElementById('pwSheet')"));
  await ev("document.getElementById('pwN1').value='abc';document.getElementById('pwN2').value='abc';document.querySelector('#pwSheet form').requestSubmit();" + T(300));
  check("too short is refused", /حداقل ۶/.test(await ev("return document.getElementById('pwErr').textContent")));
  await ev("document.getElementById('pwN1').value='Shagerd۷7';document.getElementById('pwN2').value='Shagerd77';document.querySelector('#pwSheet form').requestSubmit();" + T(1500));
  check("letters and Persian digits are taken", await ev("return !document.getElementById('pwSheet')"), await ev("return (document.getElementById('pwErr')||{}).textContent||''"));
  await ev("document.getElementById('lockBtn').click();" + T(800));
  check("remembered name: letters keyboard at once, no typing needed", await ev("return document.getElementById('gateUser').value==='شاگرد'&&document.getElementById('gatePin').inputMode==='text'"));
  await ev("const u=document.getElementById('gateUser');u.value='شاگرد';u.dispatchEvent(new Event('input'));" + T(100));
  check("the sign-in shows a letters keyboard for it", await ev("return document.getElementById('gatePin').inputMode==='text'"));
  await signIn("شاگرد", "5678");
  check("the old numeric one no longer opens", await ev("return !!document.getElementById('gate')"));
  await signIn("شاگرد", "Shagerd77");
  check("its own password with letters opens it", await ev("return !document.getElementById('gate')&&!document.getElementById('pwSheet')"));
  await sleep(2500);
  check("and signs a new device in at the server", (await fetch(API + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "شاگرد", p: "Shagerd77" }) })).status === 200);
  const nav = await ev("return [...document.querySelectorAll('#nav [data-tab]')].filter(b=>getComputedStyle(b).display!=='none').map(b=>b.dataset.tab).join(',')");
  check("the menu shows only invoices and orders (and its own profile)", nav === "profile,invoices,orders", nav);
  check("it opens on the first section it may see", /فاکتور/.test(await ev("return document.getElementById('topTitle').textContent")), await ev("return document.getElementById('topTitle').textContent"));
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(700));
  check("a section it may not see does not open", !/طرف‌حساب/.test(await ev("return document.getElementById('topTitle').textContent")) && /دسترسی ندارید/.test(await ev("return (document.getElementById('toast')||{}).textContent||''")), await ev("return document.getElementById('topTitle').textContent"));
  await ev("document.querySelector('#nav [data-tab=users]').click();" + T(700));
  check("nor «ورود و کاربران»", !/ورود و کاربران/.test(await ev("return document.getElementById('topTitle').textContent")));
  check("the whole-ledger export is hidden from it", await ev("return document.body.classList.contains('limited')"));
  await go("orders");
  check("orders opens", /سفارش/.test(await ev("return document.getElementById('topTitle').textContent")));
  // back to the owner: everything again
  await ev("document.getElementById('lockBtn').click();" + T(800));
  await signIn("علی", "1234");
  const nav2 = await ev("return [...document.querySelectorAll('#nav [data-tab]')].filter(b=>getComputedStyle(b).display!=='none').length");
  check("the owner sees every section again", nav2 >= 14, String(nav2));
  check("and is not limited", await ev("return !document.body.classList.contains('limited')"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
