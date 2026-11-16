// A4 preview pinch-zoom: fit() must size the sheet from the layout viewport (document.documentElement.clientWidth),
// never from window.innerWidth, which iOS Safari ties to the pinch-zoomed visual viewport and would make fit()
// re-shrink the sheet while the user is zooming in. Also checks the PDF export still works after the preview opens.
// node tests/zoom.test.mjs   (needs Chrome; serves index.html over http so the CDN libs load normally)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const here = path.dirname(import.meta.filename), root = path.dirname(here);
const OUT = process.env.ZOOM_SHOT_DIR || os.tmpdir();
const CHROME = process.env.CHROME || (process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", (process.env.HOME || "") + "/.local/opt/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"].find(p => (globalThis.process.getBuiltinModule?.("node:fs") ?? {existsSync: () => true}).existsSync(p)) : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; };

const page = http.createServer((q, r) => {
  const p = path.join(root, q.url === "/" ? "index.html" : q.url.replace(/^\//, ""));
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200); r.end(d); });
}).listen(8772);
const URL_ = "http://127.0.0.1:8772/";

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-zoom-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--user-data-dir=${prof}`, "--remote-debugging-port=9337", "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch("http://127.0.0.1:9337/json/version")).json(); } catch {} }

const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails)); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { browserContextId } } = await send("Target.createBrowserContext");
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank", browserContextId });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
for (const d of ["Page", "Runtime"]) await send(d + ".enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }, sid);
// a minimal window.claude, the same shape the offline runtime gives the app, so saveInvoice/PDF export actually run
const shim = `
  window.__store = {};
  function __doc(c, id) {
    id = id || ('t' + Math.random());
    return {
      id: id,
      set: async function (d) { (window.__store[c] = window.__store[c] || {})[id] = d; },
      update: async function (d) { var s = (window.__store[c] = window.__store[c] || {}); s[id] = Object.assign(s[id] || {}, d); },
      delete: async function () { if (window.__store[c]) delete window.__store[c][id]; }
    };
  }
  function __onSnapshot(c, f) {
    setTimeout(function () {
      var rows = window.__store[c] || {};
      f({ docs: Object.keys(rows).map(function (i) { return { id: i, data: function () { return rows[i]; } }; }) });
    });
    return function () {};
  }
  window.claude = {
    use: async function (n) {
      if (n === 'db') return { collection: function (c) { return { doc: function (id) { return __doc(c, id); }, onSnapshot: function (f) { return __onSnapshot(c, f); } }; } };
      if (n === 'downloads') return { save: async function (o) { window.__saved = window.__saved || []; window.__saved.push({ name: o.filename, size: o.data.size }); } };
      if (n === 'user') return { me: async function () { return { id: 't', name: 'test', isOwner: true }; }, can: async function () { return true; } };
      return null;
    }
  };
`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: shim }, sid);
await send("Page.navigate", { url: URL_ }, sid); await sleep(1500);
const ev = async js => { const r = await send("Runtime.evaluate", { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }, sid);
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };
const shot = async name => { const { result } = await send("Page.captureScreenshot", { format: "png" }, sid);
  fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, "base64")); };

try {
  check("app loads", await ev("return !!document.querySelector('#fab')"));
  await ev("document.querySelector('[data-act=fab]').click()"); await sleep(300);
  check("new-invoice sheet offered", await ev("return !!document.querySelector('[data-act=new][data-k=retail]')"));
  await ev("document.querySelector('[data-act=new][data-k=retail]').click()"); await sleep(400);
  await shot("zoom-before-390.png");

  await ev("document.querySelector('#pvBtn').click()"); await sleep(400);
  check("A4 preview opens", await ev("return document.body.classList.contains('pvmode')"));
  const k1 = await ev("return getComputedStyle(document.getElementById('export')).getPropertyValue('--k')");
  check("sheet is scaled down to fit the phone", parseFloat(k1) > 0 && parseFloat(k1) < 1, k1);
  await shot("zoom-fitted-390.png");

  // simulate iOS Safari's pinch-zoom quirk: window.innerWidth tracks the zoomed visual viewport and shrinks,
  // while document.documentElement.clientWidth (the layout viewport fit() must use) stays put
  await ev("Object.defineProperty(window,'innerWidth',{value:120,configurable:true});window.dispatchEvent(new Event('resize'))");
  await sleep(200);
  const k2 = await ev("return getComputedStyle(document.getElementById('export')).getPropertyValue('--k')");
  check("pinch-zoom's resize does not re-shrink the fitted sheet", k2 === k1, `${k1} -> ${k2}`);
  await shot("zoom-after-pinch-390.png");

  // a genuine layout resize (rotation, split view) must still refit
  await ev("Object.defineProperty(window,'innerWidth',{value:window.innerWidth,configurable:true});" +
    "Object.defineProperty(document.documentElement,'clientWidth',{value:900,configurable:true});window.dispatchEvent(new Event('resize'))");
  await sleep(200);
  const k3 = await ev("return getComputedStyle(document.getElementById('export')).getPropertyValue('--k')");
  check("a real layout-width change still refits", k3 !== k1, `${k1} -> ${k3}`);

  // PDF export must still work (the fit fix must not touch the off-screen, unscaled export render)
  await ev("delete document.documentElement.clientWidth;Object.defineProperty(window,'innerWidth',{value:390,configurable:true});" +
    "document.getElementById('pvbar').classList.add('on')"); // restore after the probes above
  await ev("document.getElementById('pvPdf').click()");
  let msg = "", pdfOk = false;
  for (let i = 0; i < 20; i++) { await sleep(1000); msg = await ev("return document.getElementById('pvmsg').textContent");
    if (msg.includes("آماده")) { pdfOk = true; break; } if (msg.includes("نشد")) break; }
  check("PDF export still completes", pdfOk, msg);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.log("FAIL crashed:", e.message); fails++; }
finally {
  ws.close(); chrome.kill(); page.close();
  await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
