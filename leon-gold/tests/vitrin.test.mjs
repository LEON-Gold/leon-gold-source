// «ویترین» in the ledger: the owner adds a piece with a photo, and every signed-in buyer sees it in «حساب من».
// node tests/vitrin.test.mjs   (needs offline/leon-gold-offline.html built, ../leon-gold-server beside this repo, Chrome)
// SHOT_DIR=<folder> saves 390px screenshots.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3995";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8775);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vitrin-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3995", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8775" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const call = async (p, body, token) => { const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json()) }; };

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-vitrin-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9340", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9340/json/version")).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
await send("Page.navigate", { url: "http://127.0.0.1:8775/" }, sid); await sleep(2000);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
const T = ms => `await new Promise(r=>setTimeout(r,${ms}));`;

try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='۹۹۹۹';document.getElementById('entryForm').requestSubmit();" + T(1800));
  check("signed in", await ev("return !document.getElementById('entry')&&window.__leonSync.info().on"));
  check("«ویترین» is in the menu", await ev("return !!document.querySelector('#nav [data-tab=vitrin]')"));
  await ev("document.querySelector('#nav [data-tab=vitrin]').click();" + T(700));
  check("an empty showcase says how to start", /هنوز کاری در ویترین نیست/.test(await ev("return main.textContent")));
  await ev("document.querySelector('[data-act=newvit]').click();" + T(600));
  // a photo picked from the phone: a small drawn image put into the file input
  await ev(`const c=document.createElement('canvas');c.width=400;c.height=400;const g=c.getContext('2d');g.fillStyle='#c59a50';g.fillRect(0,0,400,400);
    const b=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([b],'ring.png',{type:'image/png'}));
    const fi=document.getElementById('vm_file');fi.files=dt.files;fi.dispatchEvent(new Event('change'));` + T(2500));
  check("the photo uploads to the server and shows in the form", await ev("return document.querySelectorAll('#vmlist .vm').length===1"));
  await ev(`const set=(i,v)=>{document.getElementById(i).value=v};set('vt_name','انگشتر سولیتر');set('vt_cat','انگشتر');set('vt_w','۳٫۴۵');set('vt_aj','۱۸');
    document.getElementById('vt_desc').value='نگین زیرکونیا، سایز ۵۲';document.getElementById('vt_s2').checked=true;document.querySelector('input[name=vt_stock][value=qty]').checked=true;set('vt_qty','۳');`);
  await shot("vitrin-form-390.png");
  await ev("document.querySelector('[name=vt_stock]').scrollIntoView({block:'start'});"+T(300));await shot("vitrin-stock-390.png");
  // whose work it is must be chosen first (a supplier, or the owner's own stock)
  await ev("document.querySelector('[data-act=savevit]').click();" + T(800));
  check("not saved without its supplier", await ev("return !!document.getElementById('vt_sup')&&/تأمین‌کننده/.test((document.getElementById('toast')||{}).textContent||'')"));
  await ev("const s=document.getElementById('vt_sup');s.value='__own';s.dispatchEvent(new Event('change',{bubbles:true}));" + T(200));
  await ev("document.querySelector('[data-act=savevit]').click();" + T(2500));
  check("saved, back on the list with its card", /انگشتر سولیتر/.test(await ev("return document.querySelector('.vgrid').textContent")));
  await shot("vitrin-list-390.png");

  // a customer with a «حساب من» sign-in sees it
  const owner = (await call("/api/login", { u: "مالک", p: "9999" })).token;
  await call("/api/push", { changes: [{ c: "parties", id: "c1", d: { name: "مشتری", kind: "customer" } }] }, owner);
  await call("/api/portal/login/set", { partyId: "c1", username: "buyer1", password: "123456" }, owner);
  const pt = (await call("/api/portal/login", { u: "buyer1", p: "123456" })).token;
  const v = await call("/api/portal/vitrin", null, pt);
  check("the buyer sees the piece with its weight, wage and settlement", v.items?.length === 1 && v.items[0].weight === 3.45 && v.items[0].ajrat === 18 && v.items[0].settle.includes("۱ هفته")&&v.items[0].stock==="qty"&&v.items[0].qty===3, JSON.stringify(v.items?.[0] || v));
  check("and its photo", v.items?.[0]?.media?.length === 1 && (await fetch(API + "/api/portal/media/" + v.items[0].media[0].id, { headers: { Authorization: "Bearer " + pt } })).status === 200);

  // hidden: gone from «حساب من»
  await ev("document.querySelector('.vcard').click();" + T(700) + "document.getElementById('vt_show').checked=false;document.querySelector('[data-act=savevit]').click();" + T(2500));
  check("hiding it takes it out of «حساب من»", (await call("/api/portal/vitrin", null, pt)).items.length === 0);
  // shown only to some parties: «نمایش به»
  await ev("const db=await window.claude.use('db');await db.collection('parties').doc('c1').set({name:'مشتری',kind:'customer'});await db.collection('parties').doc('c2').set({name:'همکار دیگر',kind:'customer'});" + T(1500));
  await ev("document.querySelector('#nav [data-tab=vitrin]').click();" + T(600) + "document.querySelector('.vcard').click();" + T(700) + "document.getElementById('vt_show').checked=true;document.querySelector('input[name=vt_to][value=some]').click();" + T(300));
  check("«فقط کسانی که انتخاب می‌کنم» opens the list of parties", await ev("return !document.getElementById('vt_tobox').hidden&&document.querySelectorAll('.vtp').length===2"));
  await ev("document.querySelector('[data-act=savevit]').click();" + T(800));
  check("with nobody ticked it is not saved", (await call("/api/portal/vitrin", null, pt)).items.length === 0 && await ev("return !!document.getElementById('vt_tobox')"));
  await ev("const q=document.getElementById('vt_toq');q.value='همکار';q.dispatchEvent(new Event('input'));" + T(200));
  check("the search narrows the list", await ev("return [...document.querySelectorAll('#vt_tolist label')].filter(l=>!l.hidden).length===1"));
  await ev("document.querySelector('.vtp[value=c2]').click();document.querySelector('[data-act=savevit]').click();" + T(2500));
  check("shown only to the other party: this buyer does not see it", (await call("/api/portal/vitrin", null, pt)).items.length === 0);
  check("the card says to how many", /فقط ۱ نفر/.test(await ev("return document.querySelector('.vgrid').textContent")));
  await ev("document.querySelector('.vcard').click();" + T(700) + "document.querySelector('.vtp[value=c1]').click();document.querySelector('[data-act=savevit]').click();" + T(2500));
  check("ticked too, the buyer sees it", (await call("/api/portal/vitrin", null, pt)).items.length === 1);
  await ev("document.querySelector('.vcard').click();" + T(700) + "document.querySelector('input[name=vt_to][value=all]').click();document.querySelector('[data-act=savevit]').click();" + T(2500));
  check("back to everyone", (await call("/api/portal/vitrin", null, pt)).items.length === 1 && !/فقط/.test(await ev("return document.querySelector('.vgrid').textContent")));
  // two filters instead of a row of chips: how soon it can be had, and what kind (a category typed «نیم ست» counts as «نیم‌ست»)
  await ev("const db=await window.claude.use('db');await db.collection('vitrin').doc('va').set({name:'گوشواره حلقه',cat:'گوشواره',weight:2,carat:750,show:true,stock:'order',own:true});await db.collection('vitrin').doc('vb').set({name:'نیم‌ست برگ',cat:'نیم ست',weight:5,carat:750,show:true,stock:'none',own:true});" + T(900));
  const cards = () => ev("return [...document.querySelectorAll('.vgrid .vcard b')].map(b=>b.textContent).sort().join('|')");
  const pick = (id, v) => ev("const s=document.getElementById('" + id + "');s.value=" + JSON.stringify(v) + ";s.dispatchEvent(new Event('change',{bubbles:true}));" + T(500));
  check("two filters, no chip row", await ev("return !!document.getElementById('vstSel')&&!!document.getElementById('vctSel')&&!document.getElementById('vchips')"));
  await ev("window.scrollTo(0,0)"); await shot("vitrin-filters-390.png");
  await pick("vstSel", "qty");
  check("«آماده‌ی تحویل آنی» keeps only what is in hand", await cards() === "انگشتر سولیتر", await cards());
  await pick("vstSel", "all"); await pick("vctSel", "نیم‌ست");
  check("«نیم‌ست» finds the piece typed «نیم ست»", await cards() === "نیم‌ست برگ", await cards());
  await pick("vctSel", "all"); await pick("vstSel", "none");
  check("«ناموجود»", await cards() === "نیم‌ست برگ", await cards());
  // a personal order straight from a showcase piece (owner, 2026-11-09)
  await pick("vstSel", "all");
  await ev("[...document.querySelectorAll('.vcard')].find(c=>/گوشواره حلقه/.test(c.textContent)).click();" + T(700));
  await ev("document.querySelector('[data-act=vself]').click();" + T(800));
  check("«سفارش برای خودم» opens a personal order with the piece", await ev("return document.getElementById('of_party').value==='__self'&&/گوشواره حلقه/.test(document.querySelector('[data-k=desc]').value)&&/۲/.test(document.querySelector('[data-k=weight]').value)"), await ev("return document.getElementById('of_party').value+' '+document.querySelector('[data-k=desc]').value"));
  await ev("document.querySelector('[data-act=ovit]').click();" + T(500));
  check("«+ از ویترین» lists the showcase", await ev("return document.querySelectorAll('.ppk [data-v]').length===3"));
  await shot("order-from-vitrin-390.png");
  await ev("[...document.querySelectorAll('.ppk [data-v]')].find(b=>/نیم‌ست برگ/.test(b.textContent)).click();" + T(500));
  check("picked, it is a second line", await ev("return document.querySelectorAll('[data-k=desc]').length===2&&/نیم‌ست برگ/.test(document.querySelectorAll('[data-k=desc]')[1].value)"));
  await ev("document.querySelector('[data-act=saveorder]').click();" + T(1500));
  check("saved as a personal order", await ev("document.querySelector('#nav [data-tab=orders]').click();" + T(700) + "return [...document.querySelectorAll('.list .row')].some(r=>/شخصی/.test(r.textContent)&&/گوشواره حلقه/.test(r.textContent))"), await ev("return document.querySelector('.list').innerText"));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
