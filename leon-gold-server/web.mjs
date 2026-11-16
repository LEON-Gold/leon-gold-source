// The public site on the owner's own domain (owner, 2026-11-14): GitHub Pages is slow or out of reach from Iran, so
// until a separate Liara static app exists (leon-gold-hosting), this server also answers leongold.net and
// www.leongold.net with the site's static export in web/ (built by leon-gold-hosting: site at /, «حساب من» at
// /hesab/, the panel at /panel/, the ledger at /daftar/). Only those two hosts; api.leongold.net stays JSON only, and
// /api/ on any host is still the API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a folder name with a space («LEON PROJECT») stays a space, not %20
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
// the apps to download (owner, 2026-11-15: GitHub is slow from Iran): apps/ beside web/, at leongold.net/apps/<name>.
// Kept apart from web/ so a rebuild of the site never drops them. Plain file names only, nothing deeper.
const APPS = path.join(path.dirname(DIR), "apps");
const DL = { apk: "application/vnd.android.package-archive", exe: "application/vnd.microsoft.portable-executable", zip: "application/zip", dmg: "application/x-apple-diskimage" };
export const HOSTS = ["leongold.net", "www.leongold.net"];
const TYPES = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", webmanifest: "application/manifest+json", txt: "text/plain; charset=utf-8", xml: "application/xml",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", ico: "image/x-icon", avif: "image/avif",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", wasm: "application/wasm",
};

const hostOf = req => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
export const isSite = req => fs.existsSync(DIR) && HOSTS.includes(hostOf(req));

// a file inside web/ for this path, or null: /x/ → x/index.html, /x → x.html or x/index.html; never outside web/
function fileFor(p) {
  let rel; try { rel = decodeURIComponent(p); } catch { return null; }
  if (rel.includes("\0")) return null;
  const tries = rel.endsWith("/") ? [rel + "index.html"] : [rel, rel + ".html", rel + "/index.html"];
  for (const t of tries) {
    const f = path.join(DIR, path.normalize(t));
    if (!f.startsWith(DIR + path.sep)) return null;
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

// answers a GET or HEAD for the site; false when it is not the site's (an API path, another host)
export function serve(req, res, p) {
  if (!isSite(req) || p.startsWith("/api/") || p.startsWith("/daftar/api/") || (req.method !== "GET" && req.method !== "HEAD")) return false;
  // one address for the site: www goes to the bare domain
  if (hostOf(req) === "www.leongold.net") { res.writeHead(301, { Location: "https://leongold.net" + req.url }); res.end(); return true; }
  const am = /^\/apps\/([\w.-]+)$/.exec(p);
  if (am) {
    const f = path.join(APPS, am[1]), ext = am[1].split(".").pop().toLowerCase();
    if (!DL[ext] || am[1].startsWith(".") || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); return true; }
    const size = fs.statSync(f).size;
    res.removeHeader("Content-Security-Policy");
    res.writeHead(200, { "Content-Type": DL[ext], "Content-Length": size, "Content-Disposition": `attachment; filename="${am[1]}"`, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") { res.end(); return true; }
    fs.createReadStream(f).pipe(res); return true;
  }
  let f = fileFor(p), code = 200;
  // a folder without its slash: the site's links all end in one (trailingSlash), so send the browser there
  if (f && !p.endsWith("/") && f.endsWith(path.sep + "index.html") && !p.endsWith("index.html")) { const q = req.url.slice(p.length); res.writeHead(301, { Location: p + "/" + q }); res.end(); return true; }
  if (!f) { f = path.join(DIR, "404.html"); code = 404; if (!fs.existsSync(f)) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("not found"); return true; } }
  const ext = f.split(".").pop().toLowerCase(), type = TYPES[ext] || "application/octet-stream";
  // the server's own headers say «nothing may run or be framed»; a page needs its scripts, and «حساب من» frames the
  // ledger at /daftar/ (same origin). The rest of the API's strict headers stay.
  res.removeHeader("Content-Security-Policy");
  res.removeHeader("Cross-Origin-Resource-Policy");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // the ledger, «حساب من» and the panel are private: never in a search engine or an AI answer (owner, 2026-11-16)
  if (/^\/(daftar|hesab|panel)(\/|$)/.test(p)) res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  // hashed build files never change; pages and service workers are checked every time; the rest for a day
  const rel = path.relative(DIR, f);
  res.setHeader("Cache-Control", rel.startsWith("_next" + path.sep + "static" + path.sep) ? "public, max-age=31536000, immutable"
    : ext === "html" || rel.endsWith("sw.js") || ext === "webmanifest" ? "no-cache" : "public, max-age=86400");
  const st = fs.statSync(f), size = st.size;
  // video and big files: byte ranges, so Safari can play the museum film
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (range && code === 200) {
    let a = range[1] === "" ? Math.max(0, size - +range[2]) : +range[1], b = range[1] === "" ? size - 1 : range[2] === "" ? size - 1 : Math.min(+range[2], size - 1);
    if (a > b || a >= size) { res.writeHead(416, { "Content-Range": "bytes */" + size }); res.end(); return true; }
    res.writeHead(206, { "Content-Type": type, "Content-Length": b - a + 1, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes" });
    if (req.method === "HEAD") { res.end(); return true; }
    fs.createReadStream(f, { start: a, end: b }).pipe(res); return true;
  }
  res.writeHead(code, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
  if (req.method === "HEAD") { res.end(); return true; }
  fs.createReadStream(f).pipe(res);
  return true;
}
