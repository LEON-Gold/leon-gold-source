// Turns the old GitHub Pages preview (leon-gold.github.io/leon-gold-app/site/...) into forwarding pages to the
// real domain, keeping the path, ?query and #hash (the owner's «حساب من» links carry their key in #k=…).
// node redirects.mjs <domain> [out-dir]   → writes one index.html per site page (default .build/redirect-site).
// Move day only: copy that folder over ../leon-gold-app/site and push (see CHECKLIST.md). The ledger at
// leon-gold-app/ itself is NOT forwarded: its data lives in that address's browser storage.
import fs from "node:fs";
import path from "node:path";

const [domain, out = ".build/redirect-site"] = process.argv.slice(2);
if (!domain) { console.error("usage: node redirects.mjs <domain> [out-dir]"); process.exit(1); }
const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join("dist", d), { withFileTypes: true })) {
    const rel = path.posix.join(d, e.name);
    if (e.isDirectory() && !["daftar", "_next", "404", "_not-found"].includes(rel)) walk(rel);
    else if (e.name === "index.html") pages.push(d);
  }
})("");
fs.rmSync(out, { recursive: true, force: true });
for (const d of pages) {
  const url = `https://${domain}/${d ? d + "/" : ""}`;
  const html = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><link rel="canonical" href="${url}"><title>لئون گلد</title>
<script>location.replace(${JSON.stringify(url)}+location.search+location.hash)</script>
<meta http-equiv="refresh" content="1;url=${url}">
<body style="background:#06140e;color:#e8d29a;font:16px system-ui;text-align:center;padding:40vh 16px 0">
<a style="color:#e8d29a" href="${url}">لئون گلد به نشانی تازه رفته است: ${domain}</a></body></html>
`;
  fs.mkdirSync(path.join(out, d), { recursive: true });
  fs.writeFileSync(path.join(out, d, "index.html"), html);
}
console.log(`${pages.length} forwarding pages in ${out}: ${pages.map(p => "/" + p).join(" ")}`);
