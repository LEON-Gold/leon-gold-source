// a supplier the owner allows sends its own pieces from «حساب من» (owner, 2026-11-10): they wait in the ledger,
// marked, in «اعلان‌های حساب من» too; the owner reviews, sets the wage and shows them. node tests/studio.test.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const html = fs.readFileSync(path.join(root, "offline", "leon-gold-offline.html"));
const SRV = path.join(root, "..", "leon-gold-server", "server.mjs");
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const API = "http://127.0.0.1:3981";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => { if (q.url.startsWith("/sw.js")) { r.writeHead(404); return r.end(); } r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(html); }).listen(8773);
const data = fs.mkdtempSync(path.join(os.tmpdir(), "leon-stu-"));
const srv = spawn(process.execPath, [SRV], { env: { ...process.env, PORT: "3981", DATA_DIR: data, SETUP_USER: "مالک", SETUP_PASS: "9999", ALLOWED_ORIGINS: "http://127.0.0.1:8773" }, stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { if ((await fetch(API + "/api/health")).ok) break; } catch {} await sleep(100); }
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-stu-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9339", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9339/json/version")).json(); } catch {} }
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
await send("Page.navigate", { url: "http://127.0.0.1:8773/" }, sid); await sleep(2000);
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
  const ali = await post("/api/portal/signup", { fullName: "کارگاه علی", mobile: "09351112233", nationalId: "0013542419", biz: "gallery", shop: "کارگاه علی", licence: "12345678", union: "45678", shopAddr: "بازار بزرگ، پاساژ طلا، پلاک ۱۲", username: "ali.k", password: "Gold1405" });
  const pid = (await post("/api/portal/me", null, ali.token)).accounts[0].id;
  await ev("window.__leonSync.now();" + T(2500));
  // the owner allows it in the party's form
  await ev("document.querySelector('#nav [data-tab=parties]').click();" + T(700) + "document.querySelector('#lst [data-id=" + JSON.stringify(pid) + "]').click();" + T(700) + "document.querySelector('[data-act=editparty]').click();" + T(700) + set("#pf_up", "1") + set("#pf_kind", "supplier") + "document.querySelector('[data-act=saveparty]').click();" + T(1500));
  await ev("window.__leonSync.now();" + T(2000));
  check("the party may upload now", (await post("/api/portal/me", null, ali.token)).accounts[0].upload === true);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const m = await post("/api/portal/studio/media", { data: png }, ali.token);
  const sv = await post("/api/portal/studio/save", { name: "النگو طرح برگ", cat: "النگو", weight: "12.5", carat: 750, supAjrat: "6", qty: 2, desc: "دست‌ساز", media: [m] }, ali.token);
  check("the supplier sends a piece", sv.ok === true, JSON.stringify(sv));
  await ev("window.__leonSync.now();" + T(2500) + "document.querySelector('#nav [data-tab=vitrin]').click();" + T(900));
  check("it waits in the showcase, marked and first", /تازه از تأمین‌کننده/.test(await ev("return document.querySelector('.vgrid .vcard').textContent")));
  await ev("document.querySelector('#nav [data-tab=feed]').click();" + T(1500));
  check("«اعلان‌های حساب من» says it", /کارگاه علی کار «النگو طرح برگ» را برای ویترین فرستاد/.test(await ev("return document.querySelector('.feed').innerText")));
  await shot("studio-feed-390.png");
  await ev("[...document.querySelectorAll('.feed [data-act=editvit]')][0].click();" + T(1200));
  check("its form names the supplier and its wage", /کارگاه علی[\s\S]*اجرت خودش: ۶٪/.test(await ev("return document.getElementById('main').innerText")));
  await shot("studio-form-390.png");
  check("its photo fills the square (not drawn from its corner)", await ev("const t=document.querySelector('.vm .vth'),c=getComputedStyle(t);return c.backgroundSize==='cover'&&/50%/.test(c.backgroundPosition)"), await ev("const c=getComputedStyle(document.querySelector('.vm .vth'));return c.backgroundSize+' '+c.backgroundPosition"));
  await ev(set("#vt_aj", "12") + "document.getElementById('vt_show').checked=true;document.querySelector('[data-act=savevit]').click();" + T(2500) + "window.__leonSync.now();" + T(2000));
  const own = (await post("/api/login", { u: "مالک", p: "9999" })).token;
  const v = (await post("/api/pull?since=0", null, own)).changes.filter(c => c.c === "vitrin" && c.id === sv.id).pop().d;
  check("reviewed: no longer waiting, shown, its wage kept", !v.pending && v.show === true && v.supAjrat === 6 && v.ajrat === 12, JSON.stringify({ p: v.pending, s: v.show, sa: v.supAjrat, a: v.ajrat }));
  check("reviewed: it stays in the feed (pendingAt kept)", !!v.pendingAt, String(v.pendingAt));
  check("the supplier sees it live", (await post("/api/portal/vitrin", null, ali.token)).mine.find(x => x.id === sv.id)?.status === "live");
  check("no script errors", !errors.length, errors.slice(0, 3).join(" | "));
} catch (e) { console.log("FAIL " + e.message); fails++; }
finally {
  ws.close(); chrome.kill(); srv.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); } catch {}
}
console.log(fails ? fails + " failed" : "all passed");
