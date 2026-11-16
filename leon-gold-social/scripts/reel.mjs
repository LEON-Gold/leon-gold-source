// Renders a reel page (web/reels/<name>.html) to web/out/reel-<name>.mp4: headless Chrome draws each frame with seek(t),
// ffmpeg joins them (H.264, 30 fps, 1080×1920, no sound: the owner adds music in Instagram's own editor).
//   node scripts/reel.mjs ayar [safar …]      (needs Chrome and ffmpeg on PATH)
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const web = path.join(path.dirname(import.meta.filename), "..", "web");
const CHROME = process.env.CHROME || { win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform] || "google-chrome", FPS = 30, PORT = 8791, DBG = 9391;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const srv = http.createServer((q, r) => {
  const f = path.join(web, decodeURIComponent(new URL(q.url, "http://x").pathname));
  if (!f.startsWith(web) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
}).listen(PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "leon-reel-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${prof}`, `--remote-debugging-port=${DBG}`, "about:blank"], { stdio: "ignore" });
let ver; for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json(); } catch {} }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const wait = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: sid } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sid);
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false }, sid);
const ev = async js => (await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true }, sid)).result.result.value;

try {
  for (const name of process.argv.slice(2)) {
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/reels/${name}.html?render` }, sid); await sleep(1500);
    await ev("ready.then(()=>new Promise(r=>setTimeout(r,500)))");
    const len = await ev("LEN"), n = Math.round(len * FPS), out = path.join(web, "out", `reel-${name}.mp4`);
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
    for (let f = 0; f < n; f++) {
      await ev(`seek(${f / FPS})`);
      const { result } = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 }, sid);
      if (!ff.stdin.write(Buffer.from(result.data, "base64"))) await new Promise(r => ff.stdin.once("drain", r));
      if (f % 150 === 0) process.stdout.write(`${name}: ${f}/${n}\r`);
    }
    ff.stdin.end(); await new Promise(r => ff.on("close", r));
    console.log(`${name}: ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, ${len} s)`);
  }
} finally {
  ws.close(); chrome.kill(); srv.close(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
}
