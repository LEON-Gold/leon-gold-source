// «ثبت نام» from «حساب من» (accounts made at once), kinds of business the owner edits, wages by kind and the public site (owner, 2026-11-09).
// node tests/signup.test.mjs   (needs offline/leon-gold-offline.html built without -SyncUrl, ../leon-gold-server beside this repo, Chrome)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3986";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8768);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-su-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3986", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8768" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-su-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9334", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9334/json/version")).json(); } catch {} }
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

const shot = async name => { if (!process.env.SHOT_DIR) return; const { result } = await send("Page.captureScreenshot", { format: "png" }, sid); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(result.data, "base64")); };
try {
  await ev("var uu=document.getElementById('enUrl');if(uu)uu.value=" + JSON.stringify(API) + ";document.getElementById('enUser').value='مالک';document.getElementById('enPass').value='9999';document.getElementById('entryForm').requestSubmit();" + T(2500));
  await ev("const s=document.getElementById('nfSheet');if(s)s.remove();");
  const post = async (p, b, tok) => { const r = await fetch(API + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const sara = await post("/api/portal/signup", { fullName: "سارا رضایی", mobile: "09121234567", nationalId: "0084575948", biz: "retail", username: "sara.r", password: "Gold1405" });
  check("a customer signs up and is signed in at once", !!sara.token && sara.username === "sara.r", JSON.stringify(sara));
  const ali = await post("/api/portal/signup", { fullName: "گالری علی", mobile: "09351112233", nationalId: "0013542419", biz: "gallery", shop: "گالری علی", licence: "12345678", union: "45678", shopAddr: "بازار بزرگ، پاساژ طلا، پلاک ۱۲", username: "ali.k", password: "Gold1405" });
  check("a colleague signs up with the trade's details", !!ali.token, JSON.stringify(ali));
  await ev("window.__leonSync.now();" + T(2500) + "document.querySelector('#nav [data-tab=home]').click();" + T(800));
  const sec = async () => (await ev("const s=document.getElementById('suSec');return s?s.innerText:''")).replace(/\s+/g, " ");
  check("the home page tells who joined", /سارا رضایی/.test(await sec()) && /گالری علی/.test(await sec()), await sec());
  check("a colleague's claim is shown to check", /ادعای همکاری/.test(await sec()) && /12345678|۱۲۳۴۵۶۷۸/.test(await sec()));
  await shot("signup-ledger-390.png");
  await ev("[...document.querySelectorAll('#suSec .row')].find(r=>/سارا/.test(r.textContent)).querySelector('[data-act=suok]').click();" + T(500));
  check("«دیدم» takes it off the list", !/سارا رضایی/.test(await sec()) && /گالری علی/.test(await sec()));
  check("the party is in the ledger with its kind of business", await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(800) + "return /سارا رضایی/.test(document.getElementById('main').textContent)&&/مشتری تک‌فروشی/.test(document.getElementById('main').textContent)"));
  // the owner's own kinds of business
  await ev("document.querySelector('[data-act=newparty]').click();" + T(700) + "document.querySelector('[data-act=bizedit]').click();" + T(400));
  check("the kinds of business can be edited", await ev("return document.querySelectorAll('.bzr').length===5"));
  await ev("const r=[...document.querySelectorAll('.bzr')].find(r=>r.querySelector('.bzn').value==='بنکداری');r.querySelector('.bzn').value='بنکدار طلا';document.querySelector('.bzbox [data-add]').click();" + T(200) + "const q=[...document.querySelectorAll('.bzn')].pop();q.value='جواهرفروشی';[...document.querySelectorAll('.bzg')].pop().value='colleague';document.querySelector('.bzbox').requestSubmit();" + T(1500));
  check("renamed and added", await ev("const o=[...document.querySelectorAll('#pf_biz option')].map(o=>o.textContent).join('|');return /بنکدار طلا/.test(o)&&o.includes('جواهرفروشی (همکار)')&&!/بنکداری/.test(o)"), await ev("return [...document.querySelectorAll('#pf_biz option')].map(o=>o.textContent).join('|')"));
  check("a kind in use can only be hidden", await ev("document.querySelector('[data-act=bizedit]').click();" + T(400) + "const r=[...document.querySelectorAll('.bzr')].find(r=>r.querySelector('.bzn').value==='مشتری تک‌فروشی');const ok=/پنهان/.test(r.querySelector('[data-rm]').textContent);document.querySelector('.bzbox [data-n]').click();return ok"));
  await ev("document.querySelector('[data-act=back]').click();" + T(500));
  // a showcase piece: a second wage for «خانگی», and on the public site at the site's wage
  await ev("document.querySelector('#nav [data-tab=vitrin]').click();" + T(700) + "document.querySelector('[data-act=newvit]').click();" + T(800));
  await ev("const set=(i,v)=>{document.getElementById(i).value=v};set('vt_name','انگشتر سولیتر');set('vt_w','3');set('vt_aj','12');const s=document.getElementById('vt_sup');s.value='__own';s.dispatchEvent(new Event('change',{bubbles:true}));"
    + "document.querySelector('[data-act=vpradd]').click();" + T(200) + "const r=document.querySelector('.vpr');r.querySelector('.vpr_aj').value='20';r.querySelector('.vpr_b[value=retail]').checked=true;"
    + "document.querySelector('.vtg[value=lux]').checked=true;document.querySelector('.vtg[value=laser]').checked=true;"
    + "const st=document.getElementById('vt_site');st.checked=true;st.dispatchEvent(new Event('change'));document.getElementById('vt_saj').value='';");
  await ev("document.querySelector('[data-act=savevit]').click();" + T(600));
  check("on the site without its wage: not saved", /اجرت سایت/.test(await ev("return (document.getElementById('toast')||{}).textContent||''")));
  await ev("document.getElementById('vt_saj').value='25';" + T(100));
  await shot("vitrin-wages-390.png");
  await ev("document.querySelector('[data-act=savevit]').click();" + T(3000));
  check("saved, «روی سایت» on its card", /روی سایت/.test(await ev("return document.querySelector('.vgrid').textContent")));
  await ev("window.__leonSync.now();" + T(2000));
  const pub = await post("/api/public/vitrin");
  check("the public site shows it at the site's wage", pub.items?.length === 1 && pub.items[0].ajrat === 25 && pub.items[0].tags.join()==="لوکس,لیزری", JSON.stringify(pub));
  const sv = await post("/api/portal/vitrin", null, sara.token), av = await post("/api/portal/vitrin", null, ali.token);
  check("«مشتری تک‌فروشی» sees the second wage, the gallery the base one", sv.items?.[0]?.ajrat === 20 && av.items?.[0]?.ajrat === 12, JSON.stringify([sv.items?.[0]?.ajrat, av.items?.[0]?.ajrat]));
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
