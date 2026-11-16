// Checks a built web root before it goes anywhere.  node test.mjs dist <domain> [--serve <port>]
// --serve also serves the folder the way the static host does (dir/ → dir/index.html, else 404.html),
// for screenshots of the real paths.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const [root = "dist", domain = "example.ir", flag, port] = process.argv.slice(2);
const fail = [];
const must = (ok, msg) => ok || fail.push(msg);
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).replace(/\\/g, "/")]);

const files = walk("");
for (const f of ["index.html", "404.html", "panel/index.html", "hesab/index.html", "museum/index.html", "og.jpg", "leaf.png",
  "daftar/index.html", "daftar/sw.js", "daftar/manifest.webmanifest", "daftar/icon-180.png", "liara.json"])
  must(files.includes(f), `missing ${f}`);
must(!files.some(f => /(^|\/)t(\d|-[\w-]+)?\.html$/.test(f)), "screenshot helper t*.html is in the build");

// nothing may still point at the GitHub Pages preview path
for (const f of files.filter(f => /\.(html|js|css|txt|json)$/.test(f)))
  must(!/\/leon-gold-app\/site|leon-gold\.github\.io\/leon-gold-app/.test(read(f)), `${f} still points at the GitHub preview`);

const home = read("index.html");
must(home.includes(`https://${domain}/og.jpg`), "share card (og:image) is not on the domain");
must(home.includes('href="/daftar/"'), "home has no link to /daftar/");
must(read("daftar/index.html").includes("api.leongold.net") || read("daftar/index.html").includes(domain), "ledger has no sync address");

// every root-absolute src/href in the pages must exist in the build
for (const f of files.filter(f => f.endsWith(".html") && !f.startsWith("daftar/"))) {
  for (const [, u] of read(f).matchAll(/(?:src|href)="(\/[^"#?]*)/g)) {
    if (u.startsWith("//")) continue;
    const p = decodeURI(u).replace(/^\//, "");
    const ok = p === "" || files.includes(p) || files.includes(p.replace(/\/?$/, "/index.html"));
    must(ok, `${f}: broken link ${u}`);
  }
}

// root-absolute photos, fonts and videos named inside scripts and styles (vitrin, museum, leaf) must exist too
for (const f of files.filter(f => /\.(js|css)$/.test(f) && !f.startsWith("daftar/"))) {
  for (const [, u] of read(f).matchAll(/["'(](\/[\w\-./]+\.(?:webp|png|jpe?g|webm|mp4|woff2|svg))["')]/g))
    must(files.includes(decodeURI(u).slice(1)), `${f}: missing asset ${u}`);
}

if (fail.length) { console.error("FAIL\n  " + [...new Set(fail)].join("\n  ")); process.exit(1); }
console.log(`ok: ${files.length} files, all checks passed`);

if (flag === "--serve") {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };
  http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    const found = fs.existsSync(p);
    if (!found) p = path.join(root, "404.html");
    res.writeHead(found ? 200 : 404, { "content-type": types[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  }).listen(+port || 3200, () => console.log(`serving ${root} on http://localhost:${+port || 3200}/`));
}
