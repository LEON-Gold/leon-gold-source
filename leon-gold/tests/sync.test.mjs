// Two devices against a local leon-gold-server: phone data seeds the server, the PC takes it over,
// edits and deletions travel both ways, offline edits wait in the outbox, and a pending edit is never overwritten.
// node tests/sync.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

// the app file on two origins = two devices with separate storage
const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8771);
const PHONE = "http://127.0.0.1:8771/", PC = "http://localhost:8771/";

const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-sync-"));
let srv;
const startServer = async (pass = "1234") => {
  srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3999", DATA_DIR: data, SETUP_USER: "leon", SETUP_PASS: pass, ALLOWED_ORIGINS: "http://127.0.0.1:8771,http://localhost:8771" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { if ((await fetch("http://127.0.0.1:3999/api/health")).ok) return; } catch {} await sleep(100); }
  throw new Error("server did not start");
};
await startServer();

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9336", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9336/json/version")).json(); } catch {} }

// minimal CDP client
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
async function open(url) {
  const { result: { browserContextId } } = await send("Target.createBrowserContext");
  const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
  for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sessionId);
  await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: prof, browserContextId });
  await send("Page.navigate", { url }, sessionId); await sleep(2500);
  return { sid: sessionId, url };
}
const ev = async (d, js) => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, d.sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const reload = async d => { await send("Page.navigate", { url: d.url }, d.sid); await sleep(2500); };
const setDoc = (d, c, i, v) => ev(d, `const db=await window.claude.use('db');await db.collection(${JSON.stringify(c)}).doc(${JSON.stringify(i)}).${v === null ? "delete()" : "set(" + JSON.stringify(v) + ")"}`);
// read through onSnapshot, the way the app itself sees the data
const getCol = (d, c) => ev(d, `const db=await window.claude.use('db');return await new Promise(r=>{const off=db.collection(${JSON.stringify(c)}).onSnapshot(s=>{off();r(Object.fromEntries(s.docs.map(x=>[x.id,x.data()])))})})`);
const info = d => ev(d, "return window.__leonSync.info()");
const now = d => ev(d, "await window.__leonSync.now()");

try {
  const phone = await open(PHONE), pc = await open(PC);
  check("app starts on both devices", (await ev(phone, "return !!window.__leonSync")) && (await ev(pc, "return !!window.__leonSync")));

  // phone: the real data, plus a product photo
  await setDoc(phone, "parties", "p1", { name: "همکار یک", gram: 12.5 });
  await setDoc(phone, "invoices", "i1", { party: "p1", lines: [{ w: 3.2, c: 750 }] });
  const photo = await ev(phone, "const a=await window.claude.use('assets');const r=await a.upload(new Blob([new Uint8Array([9,8,7])],{type:'image/png'}),{type:'image/png'});return r.id");
  // pc: something that should be replaced by the server's copy
  await setDoc(pc, "parties", "old", { name: "قدیمی" });

  check("wrong password refused", await ev(phone, "try{await window.__leonSync.connect('http://127.0.0.1:3999','leon','9999');return false}catch(e){return !!e.login}"));
  check("phone connects; empty server takes its data", await ev(phone, "return await window.__leonSync.connect('http://127.0.0.1:3999/','leon','۱۲۳۴')"));
  check("phone in sync, nothing waiting", (i => i.state === "ok" && i.waiting === 0)(await info(phone)), JSON.stringify(await info(phone)));

  check("pc connects; its old data replaced by the server's", await ev(pc, "return await window.__leonSync.connect('http://127.0.0.1:3999','leon','1234')"));
  let pcParties = await getCol(pc, "parties");
  check("pc has the phone's party, not its own old one", pcParties.p1?.name === "همکار یک" && !pcParties.old, JSON.stringify(pcParties));
  check("pc has the phone's invoice", (await getCol(pc, "invoices")).i1?.lines?.[0]?.w === 3.2);
  check("pc has the photo", await ev(pc, `return !!window.__leonBlobURL(${JSON.stringify(photo)}) && !window.__leonBlobURL(${JSON.stringify(photo)}).startsWith('data:')`));
  await sleep(1500);
  check("pc saved a backup file before replacing", fs.readdirSync(prof).some(f => /^leon-gold-offline-.*\.json$/.test(f)));

  // edit on pc reaches phone
  await setDoc(pc, "parties", "p1", { name: "همکار یک", gram: 20 });
  await sleep(1500); await now(phone);
  check("pc edit reaches phone", (await getCol(phone, "parties")).p1?.gram === 20);
  // shop expenses are their own collection; the CRM panel reads them from the server
  await setDoc(phone, "expenses", "e1", { date: "۱۴۰۵/۰۸/۰۵", cat: "rent", r: 500000000, w: 0, lab: 750, g: 0, ts: new Date().toISOString() });
  await sleep(1500); await now(phone); await now(pc);
  check("phone expense reaches pc", (await getCol(pc, "expenses")).e1?.r === 500000000);

  // delete on phone reaches pc
  await setDoc(phone, "invoices", "i1", null);
  await sleep(1500); await now(pc);
  check("phone delete reaches pc", !(await getCol(pc, "invoices")).i1);

  // server down: phone keeps working, change waits, then goes when the server is back
  srv.kill(); await sleep(300);
  await setDoc(phone, "parties", "p2", { name: "بدون اینترنت" });
  await sleep(1500);
  let pi = await info(phone);
  check("offline edit waits in the outbox", pi.waiting === 1 && pi.state !== "ok", JSON.stringify(pi));
  check("offline edit is on the phone already", (await getCol(phone, "parties")).p2?.name === "بدون اینترنت");
  await reload(phone);
  check("outbox survives closing the app", (await info(phone)).waiting === 1);
  await startServer(); await now(phone); await now(pc);
  check("waiting edit delivered after the server is back", (await getCol(pc, "parties")).p2?.name === "بدون اینترنت");
  check("phone outbox empty again", (await info(phone)).waiting === 0);

  // a pending local edit is not overwritten by the server's older copy
  await setDoc(pc, "parties", "p1", { name: "از کامپیوتر", gram: 1 }); await sleep(1500);
  srv.kill(); await sleep(300);
  await setDoc(phone, "parties", "p1", { name: "از گوشی", gram: 2 }); await sleep(300);
  await startServer();
  await ev(phone, "await window.__leonSync.now()");
  await now(pc);
  check("last edit wins on both devices", (await getCol(phone, "parties")).p1?.name === "از گوشی" && (await getCol(pc, "parties")).p1?.name === "از گوشی");

  // two devices editing the same invoice while offline: the later save wins, lines and all, not just a merge
  await setDoc(pc, "invoices", "i9", { party: "p1", lines: [{ w: 1, c: 750 }] }); await sleep(1500);
  srv.kill(); await sleep(300);
  await setDoc(phone, "invoices", "i9", { party: "p1", lines: [{ w: 2, c: 750 }, { w: 3, c: 999 }] }); await sleep(300);
  await startServer();
  await ev(phone, "await window.__leonSync.now()");
  await now(pc);
  check("two devices on one invoice: later edit wins everywhere",
    (await getCol(phone, "invoices")).i9?.lines?.length === 2 && (await getCol(pc, "invoices")).i9?.lines?.length === 2);

  // a long offline queue: many edits wait, not just one, and all of them drain once back online
  srv.kill(); await sleep(300);
  await ev(phone, "const db=await window.claude.use('db');for(let i=0;i<350;i++)await db.collection('parties').doc('q'+i).set({name:'ردیف '+i})");
  await sleep(500);
  check("long offline queue: every edit waits", (await info(phone)).waiting === 350, JSON.stringify(await info(phone)));
  await startServer();
  await now(phone);
  check("long offline queue: outbox drains after reconnect", (await info(phone)).waiting === 0, JSON.stringify(await info(phone)));
  await now(pc);
  check("long offline queue: the other device gets all of it",
    Object.keys(await getCol(pc, "parties")).filter(k => k.startsWith("q")).length === 350);

  // a new password on the server signs the devices out: the edit waits, and signing in again sends it (no disconnect, nothing lost)
  srv.kill(); await sleep(300); await startServer("5678");
  await setDoc(phone, "parties", "p4", { name: "بعد از رمز تازه" }); await sleep(1500);
  pi = await info(phone);
  check("expired login keeps the edit waiting", pi.state === "login" && pi.waiting === 1, JSON.stringify(pi));
  await ev(phone, "document.querySelector('#offBadge button').click();document.querySelector('[data-o=sync]').click()");
  check("sync panel offers signing in again", await ev(phone, "return !!document.querySelector('#lgSync [data-s=re]')"));
  await ev(phone, "document.querySelector('#lgSync [data-s=x]').click()");
  check("old password refused on relogin", await ev(phone, "try{await window.__leonSync.relogin('leon','1234');return false}catch(e){return !!e.login}"));
  await ev(phone, "await window.__leonSync.relogin('leon','۵۶۷۸')");
  pi = await info(phone);
  check("relogin sends the waiting edit", pi.state === "ok" && pi.waiting === 0 && pi.on, JSON.stringify(pi));
  await ev(pc, "await window.__leonSync.relogin('leon','5678')");
  const pcAfter = await getCol(pc, "parties");
  check("other device signs in again and gets it", pcAfter.p4?.name === "بعد از رمز تازه" && pcAfter.p1?.name === "از گوشی", JSON.stringify(pcAfter));

  // reopened app stays connected and the app itself renders
  await reload(pc);
  check("pc still connected after reopening", (await info(pc)).on && (await getCol(pc, "parties")).p2);
  check("badge shows the sync state", /همگام|آفلاین/.test(await ev(pc, "await new Promise(r=>setTimeout(r,800));return document.querySelector('#offBadge button').textContent")));
  await ev(pc, "document.querySelector('#offBadge button').click();document.querySelector('[data-o=sync]').click()");
  check("sync panel opens and shows the user", /leon/.test(await ev(pc, "return document.getElementById('lgSync').innerText")));
  await ev(pc, "document.querySelector('#lgSync [data-s=x]').click()");

  // a photo the server refuses (over 15 MB) stays waiting but must not stop this device from pulling
  await setDoc(pc, "parties", "p6", { name: "بعد از عکس بزرگ" }); await now(pc);
  await ev(phone, "const a=await window.claude.use('assets');await a.upload(new Blob([new Uint8Array(16*1024*1024)],{type:'image/jpeg'}),{type:'image/jpeg'})");
  await sleep(300); await now(phone);
  check("refused photo does not block pulling", (await getCol(phone, "parties")).p6?.name === "بعد از عکس بزرگ");
  check("refused photo stays waiting", (await info(phone)).waiting >= 1, JSON.stringify(await info(phone)));
  // restoring a ledger backup keeps collections the file does not hold (the CRM panel's crm_*)
  await setDoc(pc, "crm_notes", "n1", { t: "یادداشت پنل" }); await now(pc); await now(phone);
  check("phone has the panel's note", (await getCol(phone, "crm_notes")).n1?.t === "یادداشت پنل");
  const bk = { app: "leon-gold", format: 3, at: new Date().toISOString(), parties: [{ id: "p1", name: "از پشتیبان" }], invoices: [], settlements: [], products: [], orders: [], targets: [], expenses: [], prices: [], settings: [], log: [] };
  await ev(phone, "window.__leonImport(new File([" + JSON.stringify(JSON.stringify(bk)) + "],'b.json')); return 1");
  await sleep(4000); await now(phone); await sleep(500); await now(pc);
  check("restore replaced the ledger", (await getCol(pc, "parties")).p1?.name === "از پشتیبان" && !(await getCol(pc, "parties")).p6);
  check("restore kept the panel's crm_* data", (await getCol(pc, "crm_notes")).n1?.t === "یادداشت پنل", JSON.stringify(await getCol(pc, "crm_notes")));

  // disconnect: data stays, later edits are not queued
  await ev(pc, "await window.__leonSync.disconnect()");
  await setDoc(pc, "parties", "p3", { name: "بعد از قطع" });
  check("after disconnect: data kept, nothing queued", (await getCol(pc, "parties")).p1 && (await info(pc)).waiting === 0 && !(await info(pc)).on);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.log("FAIL crashed:", e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
