// The entry gate: a device that has never signed in to the sync server must see only the sign-in form, no
// tools, no data, until it does; a device that already has a token boots straight past it, unchanged.
// node tests/entry.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
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

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8773);
const PHONE = "http://127.0.0.1:8773/", PC = "http://localhost:8773/";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-entry-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3998", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8773,http://localhost:8773" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch("http://127.0.0.1:3998/api/health")).ok) break; } catch {} await sleep(100); }
// a staff account, as older servers allowed (the server now lets only the owner sign in; leon-gold-server/test/auth.test.mjs)
const ownerToken = (await (await fetch("http://127.0.0.1:3998/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ u: "مالک", p: "9999" }) })).json()).token;
await fetch("http://127.0.0.1:3998/api/users", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + ownerToken }, body: JSON.stringify({ u: "فروشنده", p: "1111" }) });

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-entry-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9338", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9338/json/version")).json(); } catch {} }
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
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
  await send("Page.navigate", { url }, sessionId); await sleep(2000);
  return { sid: sessionId, url };
}
const ev = async (d, js) => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, d.sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const reload = async d => { await send("Page.navigate", { url: d.url }, d.sid); await sleep(1800); };
// SHOT_DIR=<folder> saves 390px screenshots of the owner's screens
const shot = async (d, name) => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, d.sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
// this test build has no baked-in server address, so the gate also asks for it (the published build fills it in)
const fill = (u, p) => `var uu=document.getElementById('enUrl');if(uu)uu.value='http://127.0.0.1:3998';` +
  `document.getElementById('enUser').value=${JSON.stringify(u)};document.getElementById('enPass').value=${JSON.stringify(p)};` +
  `document.getElementById('entryForm').requestSubmit();`;

try {
  const phone = await open(PHONE);
  check("a fresh device shows the entry gate", await ev(phone, "return !!document.getElementById('entry')"));
  check("the gate is what is on top (not hidden under the start splash)", await ev(phone,
    "var r=document.getElementById('enUser').getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===document.getElementById('enUser')"));
  check("nothing else is on the page behind it", await ev(phone, "return document.getElementById('main').innerHTML===''&&document.getElementById('fab').hidden"));
  check("the background does not scroll behind the gate", await ev(phone, "return document.body.style.overflow==='hidden'"));
  check("no data loaded (initDb never ran)", await ev(phone, "return !window.__leonSync.info().on"));

  check("wrong password stays gated with an error", await ev(phone, fill("مالک", "0000") +
    "await new Promise(r=>setTimeout(r,800));" +
    "return !!document.getElementById('entry')&&/درست نیست/.test(document.getElementById('enErr').textContent)"));

  await ev(phone, fill("مالک", "9999") + "await new Promise(r=>setTimeout(r,1500))");
  check("correct login opens the gate and loads the ledger", await ev(phone, "return !document.getElementById('entry')&&window.__leonSync.info().on"));
  check("signed in as the owner", (await ev(phone, "return window.__leonSync.info().owner")) === true);
  await ev(phone, "const db=await window.claude.use('db');await db.collection('parties').doc('p1').set({name:'طرف آزمایشی'})");
  await sleep(1200);

  await reload(phone);
  check("a device that already signed in boots straight past the gate", await ev(phone, "return !document.getElementById('entry')"));
  check("its data is there after reopening", (await ev(phone,
    "const db=await window.claude.use('db');return await new Promise(r=>{const off=db.collection('parties').onSnapshot(s=>{off();r(Object.fromEntries(s.docs.map(x=>[x.id,x.data()])))})})"
  )).p1?.name === "طرف آزمایشی");

  check("the owner sees «کاربران سرور»", await ev(phone, "document.querySelector('[data-tab=users]').click();await new Promise(r=>setTimeout(r,600));return !!document.getElementById('secServer')&&!!document.querySelector('.sutabs')"));

  // the owner's two tabs: parties' «حساب من» and receipts (no staff: the ledger is the owner's alone)
  const S3 = "http://127.0.0.1:3998", J = { "Content-Type": "application/json" }, OWN = { ...J, Authorization: "Bearer " + ownerToken };
  const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;
  check("the owner has «پنل مدیریت» in the menu", await ev(phone, "var b=document.querySelector('#nav [data-tab=admin]');return !!b&&!b.hidden"));
  // the site's notes-and-occasions panel opens from inside it, signed in by a one-time code
  const purl = await ev(phone, "document.querySelector('#nav [data-tab=admin]').click();" + T(600) + "var o={closed:false,location:{href:''}};window.open=function(){return o};document.querySelector('#main [data-act=panelgo]').click();" + T(900) + "return o.location.href");
  check("it opens the panel beside the app with a one-time code", /\/site\/panel\/#h=[\w-]+$/.test(purl), purl);
  const red = await (await fetch(S3 + "/api/handoff/redeem", { method: "POST", headers: J, body: JSON.stringify({ code: decodeURIComponent(purl.split("#h=")[1] || "") }) })).json();
  check("the panel redeems it for a session of its own", !!red.token, JSON.stringify(red));
  await ev(phone, "document.querySelector('#nav [data-tab=users]').click();" + T(600));
  check("two tabs", await ev(phone, "return document.querySelectorAll('.sutabs button').length===2"));
  check("parties tab lists the ledger's parties", await ev(phone, "document.querySelector('[data-act=sutab][data-k=parties]').click();" + T(300) + "return /طرف آزمایشی/.test(document.getElementById('suparties').textContent)"));
  await ev(phone, "document.querySelector('#supane').scrollIntoView()"); await shot(phone, "admin-parties-390.png");
  check("«لینک ورود» makes a one-time «حساب من» link", await ev(phone, "document.querySelector('[data-act=ptinv][data-id=p1]').click();" + T(900) +
    "return /hesab\\/#k=/.test((document.getElementById('ptLink')||{}).value||'')"));
  await shot(phone, "admin-invite-390.png"); await ev(phone, "document.querySelector('.modal [data-n]').click()");
  await ev(phone, "document.querySelector('[data-act=ptoff][data-id=p1]').click();" + T(200) + "document.querySelector('.modal [data-y]').click();" + T(2500));
  check("«خاموش کن» marks the party and the server refuses its link", await ev(phone, "return /خاموش/.test(document.getElementById('suparties').textContent)") &&
    (await fetch(S3 + "/api/portal/invite", { method: "POST", headers: OWN, body: JSON.stringify({ partyId: "p1" }) })).status === 403);
  await ev(phone, "document.querySelector('[data-act=pton][data-id=p1]').click();" + T(2500));
  const inv = await (await fetch(S3 + "/api/portal/invite", { method: "POST", headers: OWN, body: JSON.stringify({ partyId: "p1" }) })).json();
  check("«روشن کن» lets it in again", !!inv.k, JSON.stringify(inv));
  // the customer sends a card-to-card receipt from «حساب من»
  const pt = (await (await fetch(S3 + "/api/portal/redeem", { method: "POST", headers: J, body: JSON.stringify({ k: inv.k }) })).json()).token;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  await fetch(S3 + "/api/portal/receipt", { method: "POST", headers: { ...J, Authorization: "Bearer " + pt }, body: JSON.stringify({ image: png, amount: 5000000, date: "1405/08/09" }) });
  check("receipts tab shows the pending receipt", await ev(phone, "document.querySelector('[data-act=sutab][data-k=receipts]').click();" + T(900) +
    "var t=document.getElementById('surcList').textContent;return /طرف آزمایشی/.test(t)&&/در انتظار/.test(t)"));
  await shot(phone, "admin-receipts-390.png");
  check("opening it shows the photo", await ev(phone, "document.querySelector('[data-act=rcopen]').click();" + T(1200) + "return !!document.querySelector('#rcImg img')"));
  await shot(phone, "admin-receipt-open-390.png");
  check("«ثبت سند دریافت» opens a prefilled settlement", await ev(phone, "document.querySelector('.modal [data-s]').click();" + T(600) +
    "return document.getElementById('sf_party').value==='p1'&&document.getElementById('sf_unit').value==='r'&&!!document.getElementById('sf_amt').value"));
  await ev(phone, "document.querySelector('[data-act=saveset]').click();" + T(2000));
  const rcs = (await (await fetch(S3 + "/api/portal/receipts", { headers: OWN })).json()).receipts;
  check("saving it records the document and marks the receipt done", rcs.length === 1 && rcs[0].status === "done", JSON.stringify(rcs.map(r => r.status)));
  check("the settlement is in the ledger", await ev(phone, "const db=await window.claude.use('db');const s=await new Promise(r=>{const off=db.collection('settlements').onSnapshot(x=>{off();r(x)})});return s.docs.some(d=>d.data().partyId==='p1'&&d.data().amount===5000000)"));

  await ev(phone, "await window.__leonSync.disconnect()");
  await reload(phone);
  check("signing out brings the gate back", await ev(phone, "return !!document.getElementById('entry')"));
  // signing back in with the iPhone's Persian keyboard: Persian digits, which the form must not block
  check("signing out did not wipe local data (visible once signed back in, password typed in Persian digits)", await ev(phone, fill("مالک", "۹۹۹۹") +
    "await new Promise(r=>setTimeout(r,1500));if(document.getElementById('entry'))return false;" +
    "const db=await window.claude.use('db');const s=await new Promise(r=>{const off=db.collection('parties').onSnapshot(x=>{off();r(x)})});return s.docs.some(d=>d.id==='p1')"));

  const pc = await open(PC);
  check("a staff account can no longer sign in", await ev(pc, fill("فروشنده", "1111") +
    "await new Promise(r=>setTimeout(r,1500));return !!document.getElementById('entry')&&!window.__leonSync.info().on"));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.log("FAIL crashed:", e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
