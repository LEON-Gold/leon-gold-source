// copies the shared market engine (leon-gold-site/lib/marketEngine.js + .css) into the ledger between markers, and
// points «تحلیل بازار» at it. Re-run after any change to the engine.
const fs = require("fs");
const f = "index.html", SITE = "../leon-gold-site/lib/";
let s = fs.readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n");
const once = (a, b) => { if (s.split(a).length !== 2) throw new Error("miss " + a.slice(0, 80)); s = s.replace(a, () => b); };
let js = fs.readFileSync(SITE + "marketEngine.js", "utf8").replace(/\r\n/g, "\n").replace("// @ts-nocheck\n", "").replace("const ME = (function", "var ME = (function").replace(/\nexport default ME;\s*$/, "\n");
const css = fs.readFileSync(SITE + "marketEngine.css", "utf8").replace(/\r\n/g, "\n");
if (/<\/script>|<\/style>/i.test(js + css)) throw new Error("closing tag inside");
const JS0 = "/* ==== ME:start (copied from leon-gold-site/lib/marketEngine.js by me-ledger.cjs) ==== */", JS1 = "/* ==== ME:end ==== */";
const CS0 = "<style id=\"me-css\">", CS1 = "</style><!--me-css-->";
const put = (a, b, body, anchor) => { const i = s.indexOf(a); if (i >= 0) { const j = s.indexOf(b, i); s = s.slice(0, i) + a + "\n" + body + "\n" + b + s.slice(j + b.length); } else once(anchor, a + "\n" + body + "\n" + b + "\n" + anchor); };
put(JS0, JS1, js, "/* market price: the Tehran gold union board (estjt.ir)");
put(CS0, CS1, css, "</head>");
// the page itself (first time only)
if (!s.includes("var MKS=")) {
  const a = s.indexOf("function vMarket(){"), b = s.indexOf("// every 2 minutes while the page is open and in front", a);
  if (a < 0 || b < 0) throw new Error("vMarket");
  s = s.slice(0, a) + `var MKS={range:90,tools:null,anim:true,prev:null};
function vMarket(){setTop('تحلیل بازار','طلا، دلار، انس و حباب',false);if(!MKS.tools)MKS.tools=ME.TOOLS0();
  main.innerHTML='<div class="me-top"><span><i class="ddot on"></i>زنده · هر ۲ دقیقه'+(MK.liveAt?' · آخرین دریافت '+esc(jtime(MK.liveAt)):'')+'</span><button class="lnk" data-act="mkrefresh" type="button">به‌روزرسانی</button></div>'+ME.page(MK.hist,MK.live,MKS);
  ME.bind(main);var now=ME.liveOf(MK.hist,MK.live);ME.flashAll(main,MKS.prev,now);MKS.prev=now;
  if(MKS.anim&&MK.hist)setTimeout(function(){MKS.anim=false},1600);
  if(!MK.hist||Date.now()-MK.histAt>3600000)mkHist().then(function(){if(S.view==='market'){MKS.anim=true;render()}});
  if(!MK.live||Date.now()-MK.liveAt>100000)mkLive(true).then(function(){if(S.view==='market')render()})}
// the chart tools and the range, inside the engine's page
document.addEventListener('click',function(e){if(S.view!=='market')return;var r=e.target.closest('[data-me-range]'),t=e.target.closest('[data-me-tool]');
  if(r){MKS.range=+r.dataset.meRange;MKS.anim=true;render()}
  else if(t){var k=t.closest('.me-fig').dataset.kind,set=MKS.tools[k];if(!set)return;if(set.has(t.dataset.meTool))set.delete(t.dataset.meTool);else set.add(t.dataset.meTool);render()}});
` + s.slice(b);
  once(`mkLive(true).then(function(){if(S.view==='market'&&!$('.mk-cur:not([hidden])'))render()})`, `mkLive(true).then(function(){if(S.view==='market'&&!document.querySelector('.me-cur[visibility="visible"]'))render()})`);
  once(`case 'mkrange':MK.range=+b.dataset.r;render();break;`, ``);
  once(`</head>`, `<style>.me-top{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12.5px;color:var(--muted);margin:0 2px}.me-top span{display:flex;align-items:center;gap:6px}</style></head>`);
}
fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s);
console.log("ok");

// ---------- the loading mark, the morph between pages, and the site's page-to-page transition (owner, 2026-11-10) ----------
{
  const ld = new Function(fs.readFileSync(SITE + "loader.js", "utf8").replace(/\r\n/g, "\n").replace("// @ts-nocheck\n", "").replace(/export const /g, "const ") + "\nreturn { LOADER_SVG, LOADER_CSS };")();
  const mjs = fs.readFileSync(SITE + "morph.js", "utf8").replace(/\r\n/g, "\n").replace("// @ts-nocheck\n", "");
  const MORPH_CSS = new Function(mjs.slice(mjs.indexOf("export const MORPH_CSS")).replace("export const MORPH_CSS =", "return"))();
  const morphJs = mjs.slice(0, mjs.indexOf("export default MORPH;")).replace("const MORPH = (function", "var MORPH = (function");
  let t = fs.readFileSync(f, "utf8"); const cr = t.includes("\r\n"); t = t.replace(/\r\n/g, "\n");
  const one = (a, b) => { if (t.split(a).length !== 2) throw new Error("miss " + a.slice(0, 80)); t = t.replace(a, () => b); };
  const putT = (a, b, body, anchor) => { const i = t.indexOf(a); if (i >= 0) { const j = t.indexOf(b, i); t = t.slice(0, i) + a + "\n" + body + "\n" + b + t.slice(j + b.length); } else one(anchor, a + "\n" + body + "\n" + b + "\n" + anchor); };
  // the splash: the mark instead of the words
  t = t.replace(/(<div id="splash"[^>]*>)(?:دفتر لئون|<div class="lg-ld-w">[\s\S]*?<\/div>)<\/div>/, (m, a) => a + '<div class="lg-ld-w">' + ld.LOADER_SVG + '<span class="lg-ld-t">دفتر لئون گلد</span></div></div>');
  const VT = `@view-transition{navigation:auto}.top{view-transition-name:lg-bar}::view-transition-group(*){animation-duration:.42s;animation-timing-function:cubic-bezier(0.77,0,0.175,1)}@media (prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation-duration:.01s!important}}`;
  putT('<style id="lg-motion">', "</style><!--lg-motion-->", ld.LOADER_CSS + "\n" + MORPH_CSS + "\n" + VT, "</head>");
  putT("/* ==== MORPH:start (copied from leon-gold-site/lib/morph.js) ==== */", "/* ==== MORPH:end ==== */", morphJs + "\nMORPH.track();", "/* ==== ME:start");
  // the hooks in render(): MORPH.before at its start, MORPH.after when the view changed (put in once by hand, 2026-11-10)
  if (!t.includes("MORPH.after(main)")) throw new Error("render hooks missing");
  fs.writeFileSync(f, cr ? t.replace(/\n/g, "\r\n") : t);
  console.log("motion ok");
}
