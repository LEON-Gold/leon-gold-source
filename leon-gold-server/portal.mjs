// «حساب من»: the customers' and suppliers' own window onto the ledger. Read-only on ledger data.
// A party signs in with the username and password the owner set for it in the ledger («کاربران»), or with a
// one-time link the owner sends from the ledger. No SMS. Portal sessions live in their own table and never open the sync API.
import crypto from "node:crypto";
import * as notify from "./notify.mjs";

const ORDER_WAIT = +(process.env.ORDER_WAIT_S || 120);
// the price the buyer's page shows: the hour's gold rate and the piece's total (both rials, whole numbers)
const priceIn = b => { const gp = Math.round(+b?.gp || 0), total = Math.round(+b?.total || 0); return gp > 0 && total > 0 && gp < 1e12 && total < 1e14 ? { gp, total, at: new Date().toISOString() } : null; };
const INVITE_DAYS = 7, SESSION_DAYS = 30, LOGIN_FAILS = 10, NAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/, PASS_MIN = 6;
const STUDIO_IMAGE = 6 * 1024 * 1024, STUDIO_VIDEO = 40 * 1024 * 1024, AVATAR_MAX = 400 * 1024, RECEIPT_MAX = 8 * 1024 * 1024, RECEIPT_PER_DAY = 8;
const IMG_RE = /^data:image\/(jpeg|png|webp|heic|heif|gif|avif);base64,([A-Za-z0-9+/=]+)$/;
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const digits = s => String(s ?? "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
// a party's own sign-in, the same way as the ledger's users: Persian digits count as Latin, usernames ignore case
const scrypt = (pass, salt) => crypto.scryptSync(pass.normalize("NFKC"), salt, 32).toString("hex");
const nameKey = s => digits(s).trim().toLowerCase();
const passKey = s => digits(s).trim();

export function setup(db) {
  db.exec(`
    -- a party's username and password hash: on the server only, never in the ledger's synced data or its backups
    CREATE TABLE IF NOT EXISTS portal_logins (party TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_invites (hash TEXT PRIMARY KEY, party TEXT NOT NULL, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_sessions (token TEXT PRIMARY KEY, who TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL);
    -- the party's electronic signature of the rules («آیین‌نامه»): the exact text it saw (by its hash), when, from where
    CREATE TABLE IF NOT EXISTS portal_terms (hash TEXT PRIMARY KEY, text TEXT NOT NULL, first INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_accepts (id INTEGER PRIMARY KEY AUTOINCREMENT, party TEXT NOT NULL, hash TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL, ip TEXT, ua TEXT);
    -- what the party wrote about itself in «حساب من» (optional); the ledger card stays the owner's own
    CREATE TABLE IF NOT EXISTS portal_info (party TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
    -- «ثبت نام» (2026-11-09): someone asks for an account themselves; the chosen username and password wait here (never in
    -- the synced data) until the owner approves it in the ledger and ties it to a party, or turns it down
    CREATE TABLE IF NOT EXISTS portal_signups (id TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', party TEXT, ip TEXT);
    -- the party's own profile photo in «حساب من» (owner, 2026-11-09): a small JPEG the page shrank, as a data URL
    -- each party's invite code (owner, 2026-11-09): a sign-up through its link is marked as brought by it (parties.refBy);
    -- the owner sets in the ledger what share of the profit on those people's purchases it earns
    CREATE TABLE IF NOT EXISTS portal_refs (party TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_photos (party TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_receipts (id TEXT PRIMARY KEY, party TEXT NOT NULL, blob TEXT NOT NULL, amount INTEGER, date TEXT, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
  `);
  // (owner, 2026-11-14) who made the password: 1 = the party itself (sign-up, or changed it), 0 = the owner set it in the
  // ledger; NULL = from before this column (read as its own when a sign-up with the same password hash exists)
  try { db.exec("ALTER TABLE portal_logins ADD COLUMN own INTEGER"); } catch {}
  db.exec("CREATE TABLE IF NOT EXISTS portal_nudges (party TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (party, kind))");
}

// ---------- the ledger's numbers, worked out the same way the ledger does (compute() in leon-gold/index.html) ----------
const all = (db, col) => db.prepare("SELECT id, data FROM docs WHERE col = ? AND data IS NOT NULL").all(col).map(r => ({ ...JSON.parse(r.data), id: r.id }));
const OST = { new: "ثبت شده", src: "در حال تهیه", ready: "آماده تحویل", done: "تحویل شده", cancel: "لغو شده" };
const invLabel = i => i.kind === "whole" ? (i.doc === "rc" ? "سند دریافتی عمده" : "فاکتور عمده") : "فاکتور خرده";
// what a trade moved: gold, or (owner, 2026-11-16) coins and silver bars, named as the ledger names them (FX there)
const TRADE_U = { cn: "سکه طرح جدید", co: "سکه طرح قدیم", ch: "نیم سکه", cq: "ربع سکه", cg: "سکه گرمی", ag: "شمش نقره" };
const tradeWord = i => TRADE_U[i.trade?.u] || "طلا";
const tradeLabel = i => (i.trade?.type === "buy" ? "خرید " + tradeWord(i) : i.trade?.type === "sell" ? "فروش " + tradeWord(i) : "نقدی") + ((i.trade?.cin || i.trade?.cout) && i.trade?.type ? " و نقدی" : "");
const n3 = v => Math.round((+v || 0) * 1000) / 1000;
// what the party already sees on the printed invoice; never the purchase wage, the margin or product ids
const lineOf = (it, kind) => ({ desc: it.desc || "", qty: +it.qty || 0, weight: n3(it.weight), carat: +it.carat || 0, ret: !!it.ret,
  ...(kind === "whole" ? { totalG: n3(it.totalG) } : { amount: Math.round(+it.amount || 0) }) });

// ---------- one invoice for the ledger's own sheet («#view» in leon-gold/index.html, opened from «حساب من») ----------
// The saved invoice's printed parts only: the sheet's inputs (vals) and the gold, trade and transfer tables the ledger
// loads with loadInvoice(). Never the items' purchase wage (costAj) or product ids; the transfer's account goes by name.
const str = v => String(v ?? "");
export const sheetOf = i => ({
  kind: i.kind === "whole" ? "whole" : "retail", doc: i.doc === "rc" ? "rc" : i.kind === "whole" ? "pd" : "", no: str(i.no), date: str(i.date),
  vals: Array.isArray(i.vals) ? i.vals.map(str) : [], rows: +i.rows || 0, tax: str(i.tax || "۰"), gp: +i.gp || 0,
  rets: Array.isArray(i.rets) ? i.rets.filter(Number.isInteger) : [],
  disc2: Array.isArray(i.disc2) ? i.disc2.slice(0, 3).map(str) : [], rprev: Array.isArray(i.rprev) ? [str(i.rprev[0]), i.rprev[1] === "cr" ? "cr" : "dr"] : null,
  gold: Array.isArray(i.gold) ? i.gold.map(g => ({ type: str(g.type), weight: +g.weight || 0, purity: str(g.purity), lab: str(g.lab), ang: str(g.ang), note: str(g.note) })) : [],
  goldDir: i.goldDir === "dr" ? "dr" : "cr",
  trade: i.trade ? { type: str(i.trade.type), u: TRADE_U[i.trade.u] ? i.trade.u : "", mode: i.trade.mode === "a" ? "a" : "w", w: +i.trade.w || 0, gp: +i.trade.gp || 0, amount: +i.trade.amount || 0, note: str(i.trade.note), cin: +i.trade.cin || 0, cout: +i.trade.cout || 0 } : null,
  hav: i.hav && i.hav.w ? { partyId: "h", partyName: str(i.hav.partyName), w: +i.hav.w || 0, dir: i.hav.dir === "in" ? "in" : "out" } : null,
});

// ---------- the way to VIP (owner, 2026-11-13): shown on the back of the party's card in «حساب من» ----------
// VIP itself stays the owner's own mark in the ledger (parties.vip); this only counts the three steps, the owner's words:
//   settle  - 4 settlements «دریافت از او» (dir in), in grams or rials; the ledger's automatic «تعیین عیار» ones and
//             «حساب من» receipts still waiting (portal_receipts, not settlements yet) do not count
//   grams   - 400 g, as 750-equivalent, of the sales to it (retail invoices and wholesale «سند پرداختی»), returns taken off
//   invite  - 3 people it invited (parties.refBy) that each have at least one sale invoice on the ledger
export const VIP_NEED = { settle: 4, grams: 400, invite: 3 };
const labOf = c => c <= 24 ? c * 1000 / 24 : c;
const pureOf = it => it.w750 != null && isFinite(+it.w750) ? +it.w750 : (+it.weight || 0) * labOf(+it.carat || 750) / 750;
const isSale = i => i.kind === "whole" ? i.doc !== "rc" : true;
export function vipOf(p, invoices, settlements, parties) {
  if (p.vip === true) return { is: true };
  const settle = settlements.filter(s => s.partyId === p.id && s.dir === "in" && (+s.amount || 0) > 0 && !/^تعیین عیار/.test(String(s.note || ""))).length;
  let g = 0;
  for (const i of invoices) if (i.partyId === p.id && isSale(i)) for (const it of i.items || []) g += (it.ret ? -1 : 1) * pureOf(it);
  const sold = new Set(invoices.filter(isSale).map(i => i.partyId));
  const invite = parties.filter(q => q.refBy === p.id && q.id !== p.id && sold.has(q.id)).length;
  const step = (k, have) => ({ k, have, need: VIP_NEED[k], done: have >= VIP_NEED[k] });
  const steps = [step("settle", settle), step("grams", Math.max(0, n3(g))), step("invite", invite)];
  return { is: false, steps, all: steps.every(s => s.done) };
}

export function account(db, partyIds) {
  const parties = all(db, "parties").filter(p => partyIds.includes(p.id));
  if (!parties.length) return [];
  const invoices = all(db, "invoices"), settlements = all(db, "settlements"), orders = all(db, "orders"), allParties = all(db, "parties");
  // a line item's photo is the product's own photo (the ledger's blobs); the product id itself is never sent
  const photoOf = Object.fromEntries(all(db, "products").filter(x => x.photo).map(x => [x.id, x.photo]));
  return parties.map(p => {
    const ent = [], bal = { g: +p.openG || 0, r: +p.openR || 0 };
    if (p.openG) ent.push({ ts: p.ts || "", label: "مانده اول دوره", u: "g", d: +p.openG });
    if (p.openR) ent.push({ ts: p.ts || "", label: "مانده اول دوره", u: "r", d: +p.openR });
    for (const i of invoices) {
      if (i.partyId !== p.id) continue;
      const u = i.kind === "whole" ? "g" : "r", d = +(u === "g" ? i.deltaG : i.deltaR) || 0;
      const lines = (i.items || []).map(it => ({ ...lineOf(it, i.kind), ...(it.pid && photoOf[it.pid] ? { photo: photoOf[it.pid] } : {}) }));
      const sheet = Array.isArray(i.vals) && i.vals.length ? sheetOf(i) : undefined;
      // gross: the invoice itself (goods sold, or bought when negative), before what was paid or received in the same document,
      // so an invoice settled on the spot is not a bare zero in «حساب من» (owner, 2026-11-08)
      const gross = i.amount != null && isFinite(+i.amount) ? +i.amount : undefined;
      bal[u] += d; ent.push({ ts: i.ts, date: i.date || "", label: invLabel(i) + (i.no ? " " + i.no : ""), u, d, lines, sheet, ...(gross !== undefined ? { gross } : {}) });
      if (u === "g" && i.deltaR) { bal.r += +i.deltaR; ent.push({ ts: i.ts, date: i.date || "", label: tradeLabel(i) + " · " + invLabel(i) + (i.no ? " " + i.no : ""), u: "r", d: +i.deltaR, sheet }); }
    }
    // a transfer order (حواله) on someone else's wholesale invoice, through this party's account: its gold side moves the other way, with the same line as the ledger's (compute())
    for (const i of invoices) {
      const h = i.hav;
      if (!h || !h.w || h.partyId !== p.id) continue;
      const d = (h.dir === "in" ? 1 : -1) * (+h.w || 0);
      bal.g += d; ent.push({ ts: i.ts, date: i.date || "", label: "حواله " + (h.dir === "in" ? "به حساب لئون از " : "از حساب لئون به ") + (i.partyName || "") + " · " + invLabel(i) + (i.no ? " " + i.no : ""), u: "g", d });
    }
    for (const s of settlements) {
      if (s.partyId !== p.id) continue;
      const d = (s.dir === "in" ? -1 : 1) * (+s.amount || 0), u = s.unit === "g" ? "g" : "r";
      bal[u] += d; ent.push({ ts: s.ts, date: s.date || "", label: s.dir === "in" ? "دریافت لئون از شما" : "پرداخت لئون به شما", u, d });
    }
    ent.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
    const run = { g: 0, r: 0 };
    for (const e of ent) { run[e.u] += e.d; e.run = e.u === "g" ? n3(run.g) : Math.round(run.r); e.d = e.u === "g" ? n3(e.d) : Math.round(e.d); if (e.gross !== undefined) e.gross = e.u === "g" ? n3(e.gross) : Math.round(e.gross); }
    const isCustomer = p.kind !== "supplier";
    const ref = id => String(id).slice(-4).toUpperCase();
    return {
      id: p.id, name: p.name || "", shop: p.shop || "", kind: p.kind || "customer", phone: p.phone || "", vip: p.vip === true, ...(p.vip === true && p.market === true ? { market: true } : {}), ...(p.upload === true ? { upload: true } : {}), ...(setting(db, "melt").on === true && groupOf(db, p.biz) === "colleague" ? { melt: true } : {}), biz: p.biz || "", group: groupOf(db, p.biz),
      bal: { g: n3(bal.g), r: Math.round(bal.r) }, ent: ent.reverse(), vipWay: vipOf(p, invoices, settlements, allParties),
      // a customer's own orders, without which workshop makes them
      orders: isCustomer ? orders.filter(o => o.partyId === p.id).sort((a, b) => (b.ts || "").localeCompare(a.ts || "")).map(o => ({
        ref: ref(o.id), date: o.date || "", due: o.due || "", status: o.status || "new", statusLabel: OST[o.status] || OST.new, deposit: Math.round(+o.deposit || 0),
        items: (o.items || []).map(it => ({ desc: it.desc || "", qty: +it.qty || 1, weight: n3(it.weight), carat: +it.carat || 0, ...(it.pid && photoOf[it.pid] ? { photo: photoOf[it.pid] } : {}) })) })) : [],
      // its share of the open orders as the maker, whatever its kind on the ledger card (the owner picks any party as an order's supplier), without whose order it is
      work: orders.filter(o => o.status !== "done" && o.status !== "cancel").flatMap(o => (o.items || []).filter(it => it.supId === p.id).map(it => ({
        ref: ref(o.id), date: o.date || "", due: o.due || "", status: o.status || "new", statusLabel: OST[o.status] || OST.new,
        desc: it.desc || "", qty: +it.qty || 1, weight: n3(it.weight), carat: +it.carat || 0, ...(it.pid && photoOf[it.pid] ? { photo: photoOf[it.pid] } : {}) }))).sort((a, b) => (a.due || "~").localeCompare(b.due || "~")),
    };
  });
}

// the showcase as a party sees it: only what is on show, newest first, never the owner's own notes or costs
// a piece the owner shows only to some parties (vitrin/<id>.to, party ids; none = everyone) is not there for the others at all,
// and the list itself never leaves the server
// ---------- kinds of business (owner, 2026-11-09): editable in the ledger (settings/biz). «colleague» types are the trade
// (gallery, wholesale…), «retail» ones buy for themselves; the group picks the rules a party signs and the sign-up fields ----------
export const BIZ_DEFAULT = [
  { k: "home", name: "خانگی", group: "retail", off: true }, { k: "retail", name: "مشتری تک‌فروشی", group: "retail" },
  { k: "gallery", name: "گالری", group: "colleague" }, { k: "melt", name: "آبشده‌فروش", group: "colleague" },
  { k: "dist", name: "دفتر پخش", group: "colleague" }, { k: "bonak", name: "بنکداری", group: "colleague" },
];
// all kinds, the hidden ones too (a kind the owner hid stays on the parties that have it, with its group)
function bizAll(db) {
  const r = db.prepare("SELECT data FROM docs WHERE col = 'settings' AND id = 'biz' AND data IS NOT NULL").get();
  const t = r ? JSON.parse(r.data).types : null;
  return (Array.isArray(t) && t.length ? t : BIZ_DEFAULT).filter(x => x && x.k && x.name).map(x => ({ k: String(x.k), name: String(x.name), group: x.group === "colleague" ? "colleague" : "retail", off: !!x.off }));
}
// the kinds offered (sign-up form, wages): not the hidden ones
export const bizTypes = db => bizAll(db).filter(x => !x.off).map(({ k, name, group }) => ({ k, name, group }));
const groupOf = (db, k) => (k && bizAll(db).find(x => x.k === k) || {}).group || "";
const partyDoc = (db, id) => { const r = id && db.prepare("SELECT data FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(id); return r ? JSON.parse(r.data) : null; };
// a piece's «نوع کار» tags (owner, 2026-11-09): the owner's list in settings/vtags {tags:[{k,name}]}, a piece may have several
export const VTAGS_DEFAULT = [{ k: "lux", name: "لوکس" }, { k: "minimal", name: "مینیمال" }, { k: "laser", name: "لیزری", group: true }, { k: "cast", name: "ریخته", group: true },
  { k: "jewel", name: "پایه جواهر", group: true }, { k: "kids", name: "بچگانه", group: true }];
// «گروه»‌ها (owner, 2026-11-13): tags with group:true, shown as the showcase's first row (لیزری، ریخته، پایه جواهر، بچگانه); a piece
// may be in several. A list saved before groups existed (no tag has a group flag) is read with the default groups added,
// so nothing stored is rewritten; the ledger's own copy of this rule is vtags() in leon-gold/index.html.
export const normTags = t => {
  const L = (Array.isArray(t) && t.length ? t : VTAGS_DEFAULT).filter(x => x && x.k && x.name).map(x => ({ k: String(x.k), name: String(x.name), ...(x.group === true ? { group: true } : {}) }));
  if (L.some(x => x.group) || (Array.isArray(t) && t.some(x => x && "group" in x))) return L;
  const G = VTAGS_DEFAULT.filter(x => x.group);
  return [...L.map(x => G.some(g => g.k === x.k) ? { ...x, group: true } : x), ...G.filter(g => !L.some(x => x.k === g.k))];
};
const setting = (db, id) => { const r = db.prepare("SELECT data FROM docs WHERE col = 'settings' AND id = ? AND data IS NOT NULL").get(id); try { return r ? JSON.parse(r.data) || {} : {}; } catch { return {}; } };
const vtagList = db => normTags(setting(db, "vtags").tags);
const vtagNames = db => new Map(vtagList(db).map(x => [x.k, x.name]));
export const vgroups = db => vtagList(db).filter(x => x.group).map(({ k, name }) => ({ k, name }));
// «کتگوری»‌ها (owner, 2026-11-13): the owner's list in settings/vcats {cats:[{k,name,alias?}]}, default the site's old fixed list.
// A piece keeps its category as a name (vitrin.cat), as it always has; a renamed category keeps the old names in alias.
export const VCATS_DEFAULT = [["ring", "انگشتر"], ["necklace", "گردنبند"], ["bracelet", "دستبند"], ["earring", "گوشواره"], ["halfset", "نیم‌ست"], ["set", "سرویس"],
  ["medal", "مدال"], ["chain", "زنجیر"], ["anklet", "پابند"], ["bangle", "النگو"], ["pendant", "پلاک و آویز"]].map(([k, name]) => ({ k, name }));
export const vcats = db => { const t = setting(db, "vcats").cats;
  return (Array.isArray(t) && t.length ? t : VCATS_DEFAULT).filter(x => x && x.k && x.name).map(x => ({ k: String(x.k), name: String(x.name), ...(Array.isArray(x.alias) && x.alias.length ? { alias: x.alias.map(String) } : {}) })); };
// the same name however it was typed: no spaces or half-spaces, Arabic ي/ك as Persian ی/ک
export const catKey = s => String(s || "").replace(/[\s\u200c\u200d]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").toLowerCase();
// a supplier's new category waits for the owner (settings/vcq_<id> {kind:"vcatreq"}): only its maker sees it until then
const catReqs = db => db.prepare("SELECT id, data FROM docs WHERE col = 'settings' AND id LIKE 'vcq\\_%' ESCAPE '\\' AND data IS NOT NULL").all().map(r => { try { return { ...JSON.parse(r.data), id: r.id }; } catch { return null; } }).filter(x => x && x.kind === "vcatreq");
// the wage a piece is shown with: a row the owner made for this party's kind of business, else the piece's own (base) wage
const baseProfit = x => x.profit == null || x.profit === "" ? 7 : +x.profit;
export const wageFor = (x, biz) => {
  const r = biz && Array.isArray(x.prices) ? x.prices.find(r => r && Array.isArray(r.biz) && r.biz.includes(biz)) : null;
  return r ? { ajrat: +r.ajrat || 0, profit: r.profit == null || r.profit === "" ? baseProfit(x) : +r.profit } : { ajrat: +x.ajrat || 0, profit: baseProfit(x) };
};
const pieceOut = (x, w, tags) => ({
  id: x.id, code: String(x.code ?? ""), tags: (Array.isArray(x.tags) ? x.tags : []).map(k => tags && tags.get(String(k))).filter(Boolean), name: String(x.name), cat: String(x.cat ?? ""), desc: String(x.desc ?? ""), weight: n3(x.weight), carat: +x.carat || 750, ajrat: w.ajrat, profit: w.profit,
  settle: Array.isArray(x.settle) ? x.settle.map(String) : [], settleNote: String(x.settleNote || ""), stock: ["qty", "order", "none"].includes(x.stock) ? x.stock : x.sold ? "none" : "order", qty: Math.max(0, Math.round(+x.qty || 0)), sold: x.stock ? x.stock === "none" : !!x.sold, media: (Array.isArray(x.media) ? x.media : []).filter(m => m && m.id).map(m => ({ id: String(m.id), type: m.type === "video" ? "video" : "image" })) });
// newest first; a date written as a number or anything else must not stop the showcase (2026-11-09: it did, with a 500)
const tsOf = x => typeof x.ts === "number" ? new Date(x.ts).toISOString() : String(x.ts ?? "");
const byNew = (a, b) => tsOf(b).localeCompare(tsOf(a));
// an odd piece is repaired, not dropped (owner, 2026-11-09): its fields are put back into their usual shape and it is
// shown; only if even that fails is it left out (logged), never the whole showcase
const ARR = { media: m => m && typeof m === "object" && m.id != null, tags: k => typeof k === "string" || typeof k === "number", settle: v => typeof v === "string", prices: r => r && typeof r === "object", to: v => typeof v === "string", biz: v => typeof v === "string" };
const mendPiece = x => Object.fromEntries(Object.entries(x).flatMap(([k, v]) => ARR[k] ? [[k, (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).filter(ARR[k])]]
  : k === "ts" ? [[k, tsOf(x)]] : v == null || ["string", "number", "boolean"].includes(typeof v) ? [[k, v]] : [[k, String(v)]]));
const outAll = (L, f) => L.flatMap(x => { try { return [f(mendPiece(x))]; } catch (e) { console.error("vitrin piece left out", x && x.id, e && e.message); return []; } });
// the public site's showcase: only pieces the owner marked «روی سایت», with the wage set for the site's visitors
export const publicItems = db => { const tg = vtagNames(db); return outAll(all(db, "vitrin").filter(x => x.site === true && x.show !== false && !x.pending && x.name).sort(byNew), x => pieceOut(x, { ajrat: x.siteAjrat == null || x.siteAjrat === "" ? +x.ajrat || 0 : +x.siteAjrat, profit: x.siteProfit == null || x.siteProfit === "" ? baseProfit(x) : +x.siteProfit }, tg)); };
// an Iranian national code: 10 digits with its check digit
export const nidOk = s => { if (!/^\d{10}$/.test(s) || /^(\d)\1{9}$/.test(s)) return false; const c = +s[9], m = [...s.slice(0, 9)].reduce((a, d, i) => a + +d * (10 - i), 0) % 11; return m < 2 ? c === m : c === 11 - m; };

export const seesPiece = (x, partyId) => !Array.isArray(x.to) || !x.to.length || x.to.includes(partyId);
// a supplier's own pieces on show (owner, 2026-11-09: «محصولات شما در لئون»): every piece it made (supId), whoever it is
// shown to, without Leon's wage, profit, tax or price
const minePieces = (db, partyId) => { const tg = vtagNames(db);
  return outAll(all(db, "vitrin").filter(x => x.name && x.supId === partyId && !x.removed).sort(byNew), x => { const o = pieceOut(x, { ajrat: 0, profit: 0 }, tg); delete o.ajrat; delete o.profit; delete o.settle; delete o.settleNote;
    return { ...o, mine: true, status: x.pending ? "pending" : x.show === false ? "hidden" : "live", supAjrat: x.supAjrat == null ? null : +x.supAjrat }; }); };
const shownItems = (db, partyId) => { const biz = (partyDoc(db, partyId) || {}).biz || "", tg = vtagNames(db);
  return outAll(all(db, "vitrin").filter(x => x.show !== false && !x.pending && x.name && seesPiece(x, partyId)).sort(byNew), x => pieceOut(x, wageFor(x, biz), tg)); };

// a party the owner switched off in the ledger (parties/<id>.portalOff) has no «حساب من» at all
const partyOn = (db, id) => { const r = db.prepare("SELECT data FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(id); return r ? JSON.parse(r.data).portalOff !== true : null; };
const partiesFor = (db, who) => (who.startsWith("party:") && partyOn(db, who.slice(6)) ? [who.slice(6)] : []);
const signOut = (db, id) => { db.prepare("DELETE FROM portal_sessions WHERE who = ?").run("party:" + id); notify.forget("party:" + id); };

// ---------- requests ----------
const ipHits = new Map();
// (when the map fills up only the entries with nothing recent go, so a flood of made-up addresses cannot wipe the limits)
const tooMany = (key, max, ms) => { if (ipHits.size > 5000) for (const [k, v] of ipHits) if (Date.now() - v[v.length - 1] > 3600e3) ipHits.delete(k); const now = Date.now(), h = (ipHits.get(key) || []).filter(t => now - t < ms); h.push(now); ipHits.set(key, h); return h.length > max; };

const fails = new Map();
const blocked = k => { const f = fails.get(k); return !!f && f.n >= LOGIN_FAILS && Date.now() - f.t < 15 * 60e3; };
const failed = k => { const f = fails.get(k), now = Date.now(); if (fails.size > 10000) for (const [x, v] of fails) if (now - v.t >= 15 * 60e3) fails.delete(x); fails.set(k, f && now - f.t < 15 * 60e3 ? { n: f.n + 1, t: f.t } : { n: 1, t: now }); };

function newSession(db, who) {
  const token = crypto.randomBytes(32).toString("base64url"), now = Date.now();
  db.prepare("INSERT INTO portal_sessions (token, who, created, seen) VALUES (?, ?, ?, ?)").run(sha(token), who, now, now);
  return token;
}
// an invite code: 6 letters/digits that cannot be mistaken for one another (no 0/O, 1/I/L)
const REF_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function inviteCode(db, pid) {
  const r = db.prepare("SELECT code FROM portal_refs WHERE party = ?").get(pid);
  if (r) return r.code;
  for (;;) {
    const code = [...crypto.randomBytes(6)].map(b => REF_ABC[b % REF_ABC.length]).join("");
    try { db.prepare("INSERT INTO portal_refs (party, code, at) VALUES (?, ?, ?)").run(pid, code, Date.now()); return code; } catch (e) { if (!/UNIQUE/.test(String(e && e.message))) throw e; }
  }
}
const refKey = s => digits(String(s || "")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
export { tooMany, partyDoc };
// the signed-in party of a «حساب من» request (melt.mjs), or null
export function partyOf(db, req) { const s = portalSession(db, req); return s ? partiesFor(db, s.who)[0] || null : null; }
export const isColleague = (db, party) => !!party && bizAll(db).some(x => x.k === party.biz && x.group === "colleague");
function portalSession(db, req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const s = db.prepare("SELECT * FROM portal_sessions WHERE token = ?").get(sha(m[1]));
  if (!s) return null;
  if (Date.now() - s.created > SESSION_DAYS * 864e5) { db.prepare("DELETE FROM portal_sessions WHERE token = ?").run(s.token); return null; }
  db.prepare("UPDATE portal_sessions SET seen = ? WHERE token = ?").run(Date.now(), s.token);
  return s;
}

// ---------- the rules, signed electronically, and the party's own details ----------
// ---------- reminders in «حساب من» (owner, 2026-11-14): a party whose password the owner made is asked to set its own, and
// one whose details are not complete is asked to fill them in. «حساب من» shows them on its home page (passNew from
// /api/portal/me; the missing details it works out from info itself); a party with notifications on also gets them on
// its phone, at most once a week each, while they are not done (nudges, run by server.mjs). ----------
export const INFO_NEED = ["fullName", "mobile", "nationalId", "birth", "postal", "address"];
const NEED_LABEL = { fullName: "نام و نام خانوادگی", mobile: "موبایل", nationalId: "کد ملی", birth: "تاریخ تولد", postal: "کد پستی", address: "نشانی" };
export const ownPass = (db, row) => !row ? true : row.own === 1 ? true : row.own === 0 ? false : !!db.prepare("SELECT 1 FROM portal_signups WHERE hash = ?").get(row.hash);
const infoMissing = (db, pid) => { const i = infoOf(db, pid) || {}; return INFO_NEED.filter(k => !String(i[k] || "").trim()); };
const NUDGE_EVERY = 7 * 864e5;
export function nudges(db, tell, now = Date.now()) {
  const last = db.prepare("SELECT at FROM portal_nudges WHERE party = ? AND kind = ?"), mark = db.prepare("INSERT INTO portal_nudges (party, kind, at) VALUES (?, ?, ?) ON CONFLICT (party, kind) DO UPDATE SET at = excluded.at");
  const due = (pid, kind) => { const r = last.get(pid, kind); return !r || now - r.at >= NUDGE_EVERY; };
  let n = 0;
  for (const { who } of db.prepare("SELECT DISTINCT who FROM push_who WHERE who LIKE 'party:%'").all()) {
    const pid = who.slice(6), row = db.prepare("SELECT * FROM portal_logins WHERE party = ?").get(pid);
    if (!row || partyOn(db, pid) !== true) continue;
    if (!ownPass(db, row) && due(pid, "pass")) { tell(pid, { title: "رمز خودتان را بگذارید", body: "رمز «حساب من» را لئون گلد ساخته؛ برای امنیت، در «پروفایل من» رمز تازه بگذارید.", tab: "profile" }); mark.run(pid, "pass", now); n++; }
    const miss = infoMissing(db, pid);
    if (miss.length && due(pid, "info")) { tell(pid, { title: "اطلاعات «حساب من» را کامل کنید", body: "هنوز ثبت نشده: " + miss.map(k => NEED_LABEL[k]).join("، "), tab: "profile" }); mark.run(pid, "info", now); n++; }
  }
  return n;
}
export const INFO_FIELDS = { fullName: 80, nationalId: 10, birth: 10, mobile: 11, phone: 12, shop: 80, address: 300, postal: 10, email: 120 };
const cleanInfo = b => Object.fromEntries(Object.entries(INFO_FIELDS).map(([k, max]) => [k, String(b?.[k] ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max)]).filter(([, v]) => v));
const lastAccept = (db, id) => db.prepare("SELECT hash, at FROM portal_accepts WHERE party = ? ORDER BY at DESC, id DESC LIMIT 1").get(id) || null;
const infoOf = (db, id) => { const r = db.prepare("SELECT data, at FROM portal_info WHERE party = ?").get(id); return r ? { ...JSON.parse(r.data), at: r.at } : null; };

export async function handle(db, req, p, { send, json, ip, owner, site, res, push }) {
  const POST = req.method === "POST";

  // ---------- the public site (no sign-in): the kinds of business for the sign-up form, and the showcase ----------
  if (p === "/api/public/biz" && req.method === "GET") return send(200, { types: bizTypes(db) });
  if (p === "/api/public/vitrin" && req.method === "GET") return send(200, { items: publicItems(db), cats: vcats(db), groups: vgroups(db) });
  // the site's order form (owner, 2026-11-14: «ثبت سفارش» goes to the ledger, not to Telegram): a visitor's request is filed
  // as a new lead (crm_leads, source «سایت»), which the ledger shows on its home page and in «سفارشات» and tells its users
  // at once (notify.ledger). No sign-in, so it is small and slowed down: 5 an hour and 20 a day per address, and a field
  // only robots fill (website) is quietly dropped.
  if (p === "/api/public/order" && POST) {
    if (tooMany("pub-order:" + ip, 5, 3600e3) || tooMany("pub-order-day:" + ip, 20, 24 * 3600e3)) return send(429, { error: "too_many" });
    const b = await json(req);
    if (String(b.website || "").trim()) return send(200, { ok: true });
    const txt = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
    const name = txt(b.name, 60), phone = digits(b.phone).replace(/\D/g, ""), what = txt(b.what, 60), note = txt(b.note, 500);
    if (name.length < 2) return send(400, { error: "bad_name" });
    if (phone.length < 10 || phone.length > 13) return send(400, { error: "bad_phone" });
    const id = "ld" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    push([{ c: "crm_leads", id, d: { id, name, phone, what, note, source: "سایت", status: "new", ts: new Date().toISOString() } }], "portal");
    return send(200, { ok: true });
  }
  const pubm = /^\/api\/public\/media\/([\w.-]{1,100})$/.exec(p);
  if (pubm && req.method === "GET") {
    const ok = publicItems(db).some(it => it.media.some(m => m.id === pubm[1]));
    const row = ok && db.prepare("SELECT type, bytes FROM blobs WHERE id = ?").get(pubm[1]);
    if (!row) return send(404, { error: "not_found" });
    res.writeHead(200, { "Content-Type": /^(image|video)\//.test(row.type) ? row.type : "application/octet-stream", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "public, max-age=3600" });
    return res.end(Buffer.from(row.bytes));
  }
  if (p.startsWith("/api/public/")) return send(404, { error: "not_found" });

  // 1. the username and password the owner set for this party in the ledger
  if (p === "/api/portal/login" && POST) {
    if (blocked("ip " + ip)) return send(429, { error: "too_many" });
    const b = await json(req), u = nameKey(b.u || ""), pass = passKey(b.p || "");
    if (blocked("u " + u)) return send(429, { error: "too_many" });
    const row = u && db.prepare("SELECT * FROM portal_logins WHERE name = ?").get(u);
    const sg = !row && u ? db.prepare("SELECT * FROM portal_signups WHERE name = ? AND status != 'approved' ORDER BY created DESC").get(u) : null;
    // the same work whether or not the username exists, so the answer time does not tell
    const h = Buffer.from(scrypt(pass, row ? row.salt : sg ? sg.salt : "decoy-salt"), "hex");
    if (!row && sg && crypto.timingSafeEqual(h, Buffer.from(sg.hash, "hex"))) return send(403, { error: sg.status === "rejected" ? "signup_rejected" : "signup_pending" });
    if (!row || !crypto.timingSafeEqual(h, Buffer.from(row.hash, "hex"))) { failed("ip " + ip); failed("u " + u); return send(401, { error: "bad_login" }); }
    fails.delete("ip " + ip); fails.delete("u " + u);
    if (!partyOn(db, row.party)) return send(403, { error: "portal_off" });
    return send(200, { token: newSession(db, "party:" + row.party) });
  }

  // «ثبت نام»: the form in «حساب من». The request reaches the ledger as a «signups» doc (no password in it) and the owner's phone
  // «ثبت نام» (owner, 2026-11-09): the account opens straight away (no approval): a party is made in the ledger with the
  // kind of business chosen, the username and password sign in at once. National code and mobile are required; someone
  // who says they are in the trade («همکار») also gives what only the trade has (business licence, union membership, shop address).
  // The ledger gets a «signups» doc to see who joined (and to check a colleague's claim); its phone gets a notification.
  if (p === "/api/portal/signup" && POST) {
    if (tooMany("signup " + ip, 5, 3600e3)) return send(429, { error: "too_many" });
    const b = await json(req), clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
    const fullName = clean(b.fullName, 80), mobile = digits(clean(b.mobile, 20)).replace(/\D/g, ""), nationalId = digits(clean(b.nationalId, 20)).replace(/\D/g, "");
    const types = bizTypes(db), bt = types.find(x => x.k === String(b.biz || "")), colleague = bt && bt.group === "colleague";
    const shop = clean(b.shop, 80), birth = digits(clean(b.birth, 10)), city = clean(b.city, 40), note = clean(b.note, 300);
    const licence = digits(clean(b.licence, 30)).replace(/\D/g, ""), union = digits(clean(b.union, 30)), shopAddr = clean(b.shopAddr, 200);
    const u = nameKey(b.username || ""), pass = passKey(b.password || "");
    const refCode = refKey(b.ref), refRow = refCode ? db.prepare("SELECT party FROM portal_refs WHERE code = ?").get(refCode) : null;
    if (refCode && (!refRow || !partyOn(db, refRow.party))) return send(400, { error: "bad_ref" });
    if (fullName.length < 3) return send(400, { error: "bad_name" });
    if (!/^09\d{9}$/.test(mobile)) return send(400, { error: "bad_mobile" });
    if (!nidOk(nationalId)) return send(400, { error: "bad_nid" });
    if (!bt) return send(400, { error: "bad_biz" });
    if (colleague && (shop.length < 2 || !/^\d{6,20}$/.test(licence) || union.length < 3 || shopAddr.length < 10)) return send(400, { error: "bad_trade" });
    if (birth && !/^1[34]\d\d\/\d{1,2}\/\d{1,2}$/.test(birth)) return send(400, { error: "bad_birth" });
    if (!NAME_RE.test(u)) return send(400, { error: "bad_username" });
    if (pass.length < PASS_MIN) return send(400, { error: "bad_password" });
    if (db.prepare("SELECT 1 FROM portal_logins WHERE name = ?").get(u) || db.prepare("SELECT 1 FROM portal_signups WHERE name = ? AND status = 'pending'").get(u)) return send(409, { error: "username_taken" });
    if (db.prepare("SELECT 1 FROM portal_info WHERE json_extract(data, '$.nationalId') = ?").get(nationalId)) return send(409, { error: "nid_taken" });
    const id = "su" + crypto.randomBytes(8).toString("hex"), pid = "pt" + crypto.randomBytes(8).toString("hex"), salt = crypto.randomBytes(16).toString("hex"), at = Date.now(), iso = new Date(at).toISOString();
    const trade = colleague ? { licence, union, shopAddr } : {};
    const refBy = refRow ? refRow.party : "", refName = refBy ? String((partyDoc(db, refBy) || {}).name || "") : "";
    const data = { fullName, mobile, nationalId, biz: bt.k, bizName: bt.name, group: bt.group, ...(refBy ? { refBy, refName } : {}), ...(shop ? { shop } : {}), ...(birth ? { birth } : {}), ...(city ? { city } : {}), ...(note ? { note } : {}), ...trade };
    const hash = scrypt(pass, salt);
    db.prepare("INSERT INTO portal_signups (id, name, salt, hash, data, created, status, party, ip) VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, ?)").run(id, u, salt, hash, JSON.stringify(data), at, pid, ip);
    push([
      { c: "parties", id: pid, d: { name: fullName, kind: "customer", phone: mobile, biz: bt.k, shop: shop || "", address: colleague ? shopAddr : city, note: "ثبت‌نام از «حساب من»" + (colleague ? " · پروانه کسب " + licence + " · اتحادیه " + union : ""), openG: 0, openR: 0, ts: iso, selfSignup: true, ...(refBy ? { refBy, refAt: iso } : {}) } },
      { c: "signups", id, d: { ...data, username: u, status: "auto", partyId: pid, ts: iso } },
    ], "portal");
    db.prepare("INSERT INTO portal_logins (party, name, salt, hash, own) VALUES (?, ?, ?, ?, 1)").run(pid, u, salt, hash);
    db.prepare("INSERT INTO portal_info (party, data, at) VALUES (?, ?, ?)").run(pid, JSON.stringify(cleanInfo({ fullName, nationalId, mobile, birth, shop, address: colleague ? shopAddr : "" })), at);
    return send(200, { ok: true, username: u, token: newSession(db, "party:" + pid) });
  }
  // the owner approves one (tied to a party it chose or just made) or turns it down
  if ((p === "/api/portal/signup/approve" || p === "/api/portal/signup/reject") && POST) {
    if (!owner()) return send(401, { error: "login" });
    const b = await json(req), sg = db.prepare("SELECT * FROM portal_signups WHERE id = ?").get(String(b.id || ""));
    if (!sg) return send(404, { error: "no_signup" });
    if (sg.status !== "pending") return send(409, { error: "signup_done", status: sg.status });
    const doc = db.prepare("SELECT data FROM docs WHERE col = 'signups' AND id = ?").get(sg.id), d = doc && doc.data ? JSON.parse(doc.data) : { ...JSON.parse(sg.data), username: sg.name };
    if (p === "/api/portal/signup/reject") {
      db.prepare("UPDATE portal_signups SET status = 'rejected' WHERE id = ?").run(sg.id);
      push([{ c: "signups", id: sg.id, d: { ...d, status: "rejected", done: new Date().toISOString() } }], "portal");
      return send(200, { ok: true });
    }
    const pid = String(b.partyId || "");
    if (!db.prepare("SELECT 1 FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(pid)) return send(404, { error: "no_party" });
    if (db.prepare("SELECT 1 FROM portal_logins WHERE party = ?").get(pid)) return send(409, { error: "has_login" });
    if (db.prepare("SELECT 1 FROM portal_logins WHERE name = ?").get(sg.name)) return send(409, { error: "username_taken" });
    db.prepare("INSERT INTO portal_logins (party, name, salt, hash, own) VALUES (?, ?, ?, ?, 1)").run(pid, sg.name, sg.salt, sg.hash);
    const info = JSON.parse(sg.data);
    if (!db.prepare("SELECT 1 FROM portal_info WHERE party = ?").get(pid)) db.prepare("INSERT INTO portal_info (party, data, at) VALUES (?, ?, ?)").run(pid, JSON.stringify(cleanInfo(info)), Date.now());
    db.prepare("UPDATE portal_signups SET status = 'approved', party = ? WHERE id = ?").run(pid, sg.id);
    push([{ c: "signups", id: sg.id, d: { ...d, status: "approved", partyId: pid, done: new Date().toISOString() } }], "portal");
    return send(200, { ok: true, username: sg.name });
  }

  // 2. the owner (ledger token) sets, changes or removes a party's username and password; a new password signs it out everywhere
  if (p === "/api/portal/logins" && req.method === "GET") {
    if (!owner()) return send(401, { error: "login" });
    return send(200, { logins: db.prepare("SELECT party, name FROM portal_logins ORDER BY name").all().map(r => ({ partyId: r.party, username: r.name })) });
  }
  if ((p === "/api/portal/login/set" || p === "/api/portal/login/remove") && POST) {
    if (!owner()) return send(401, { error: "login" });
    const b = await json(req), id = String(b.partyId || "");
    if (!db.prepare("SELECT 1 FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(id)) return send(404, { error: "no_party" });
    if (p === "/api/portal/login/remove") { db.prepare("DELETE FROM portal_logins WHERE party = ?").run(id); signOut(db, id); return send(200, { ok: true }); }
    const u = nameKey(b.username || ""), pass = b.password == null || b.password === "" ? null : passKey(b.password);
    if (!NAME_RE.test(u)) return send(400, { error: "bad_username" });
    if (db.prepare("SELECT 1 FROM portal_logins WHERE name = ? AND party != ?").get(u, id)) return send(409, { error: "username_taken" });
    const old = db.prepare("SELECT * FROM portal_logins WHERE party = ?").get(id);
    if (pass == null && !old) return send(400, { error: "bad_password" });
    if (pass != null && pass.length < PASS_MIN) return send(400, { error: "bad_password" });
    const salt = pass == null ? old.salt : crypto.randomBytes(16).toString("hex"), hash = pass == null ? old.hash : scrypt(pass, salt);
    db.prepare("INSERT INTO portal_logins (party, name, salt, hash, own) VALUES (?, ?, ?, ?, 0) ON CONFLICT (party) DO UPDATE SET name = excluded.name, salt = excluded.salt, hash = excluded.hash, own = 0").run(id, u, salt, hash);
    if (pass != null) signOut(db, id);
    return send(200, { ok: true, username: u });
  }

  // the party changes its own username and/or password (the owner gave it starting ones): the current password first;
  // a new password signs its other devices out, a new username alone does not
  if (p === "/api/portal/password" && POST) {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const id = partiesFor(db, s.who)[0], row = id && db.prepare("SELECT * FROM portal_logins WHERE party = ?").get(id);
    if (!row) return send(404, { error: "no_login" });
    if (blocked("u " + row.name)) return send(429, { error: "too_many" });
    const b = await json(req), old = passKey(b.old || ""), nu = passKey(b.new || ""), un = b.username == null ? row.name : nameKey(b.username);
    if (!crypto.timingSafeEqual(Buffer.from(scrypt(old, row.salt), "hex"), Buffer.from(row.hash, "hex"))) { failed("u " + row.name); return send(403, { error: "bad_old" }); }
    if (un !== row.name) {
      if (!NAME_RE.test(un)) return send(400, { error: "bad_username" });
      if (db.prepare("SELECT 1 FROM portal_logins WHERE name = ? AND party != ?").get(un, id)) return send(409, { error: "username_taken" });
    }
    if (nu && nu.length < PASS_MIN) return send(400, { error: "bad_password" });
    if (!nu && un === row.name) return send(400, { error: "nothing" });
    if (nu) {
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE portal_logins SET salt = ?, hash = ?, own = 1 WHERE party = ?").run(salt, scrypt(nu, salt), id);
      db.prepare("DELETE FROM portal_sessions WHERE who = ? AND token != ?").run(s.who, s.token);
    }
    if (un !== row.name) db.prepare("UPDATE portal_logins SET name = ? WHERE party = ?").run(un, id);
    return send(200, { ok: true, username: un });
  }

  // 3. a one-time link from the owner
  if (p === "/api/portal/redeem" && POST) {
    if (tooMany("redeem:" + ip, 30, 15 * 60e3)) return send(429, { error: "too_many" });
    const k = String((await json(req)).k || "");
    const row = k && db.prepare("SELECT * FROM portal_invites WHERE hash = ?").get(sha(k));
    if (!row || Date.now() > row.exp) return send(401, { error: "expired" });
    db.prepare("DELETE FROM portal_invites WHERE hash = ?").run(row.hash);
    if (!partyOn(db, row.party)) return send(403, { error: "portal_off" });
    return send(200, { token: newSession(db, "party:" + row.party) });
  }

  // the owner (signed in to the ledger) makes that link, or signs a party out everywhere
  if ((p === "/api/portal/invite" || p === "/api/portal/revoke") && POST) {
    if (!owner()) return send(401, { error: "login" });
    const id = String((await json(req)).partyId || "");
    if (!db.prepare("SELECT 1 FROM docs WHERE col = 'parties' AND id = ? AND data IS NOT NULL").get(id)) return send(404, { error: "no_party" });
    db.prepare("DELETE FROM portal_invites WHERE party = ?").run(id);
    if (p === "/api/portal/revoke") {
      signOut(db, id);
      return send(200, { ok: true });
    }
    if (!partyOn(db, id)) return send(403, { error: "portal_off" });
    const k = crypto.randomBytes(18).toString("base64url");
    db.prepare("INSERT INTO portal_invites (hash, party, exp) VALUES (?, ?, ?)").run(sha(k), id, Date.now() + INVITE_DAYS * 864e5);
    return send(200, { k, link: site + "hesab/#k=" + k, days: INVITE_DAYS });
  }

  // a customer's photo of a card-to-card transfer receipt: stored PENDING and touches no balance until the
  // owner records the real document in the ledger by hand and marks it done
  if (p === "/api/portal/receipt" && POST) {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const ids = partiesFor(db, s.who), parties = all(db, "parties").filter(x => ids.includes(x.id));
    const party = parties.find(x => x.kind !== "supplier") || parties[0];
    if (!party) return send(403, { error: "no_account" });
    if (tooMany("receipt:" + party.id, RECEIPT_PER_DAY, 24 * 3600e3)) return send(429, { error: "too_many" });
    const b = await json(req), m = IMG_RE.exec(String(b.image || ""));
    if (!m) return send(400, { error: "bad_type" });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > RECEIPT_MAX) return send(413, { error: "too_large" });
    const id = "rc" + crypto.randomBytes(16).toString("hex");
    // rev 0: lives beside the ledger's own photos but is never offered to a device's own sync pull
    db.prepare("INSERT INTO blobs (id, type, bytes, rev) VALUES (?, ?, ?, 0)").run(id, "image/" + m[1], bytes);
    db.prepare("INSERT INTO portal_receipts (id, party, blob, amount, date, ts, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')")
      .run(crypto.randomUUID(), party.id, id, b.amount != null && Number.isFinite(+b.amount) ? Math.round(+b.amount) : null, String(b.date || "").slice(0, 20), Date.now());
    return send(200, { ok: true });
  }

  // a line item's photo (the product's own, from the ledger) or a customer's own pending receipt: served only
  // to the party it belongs to, through this session, never by a public URL
  const pm = /^\/api\/portal\/photo\/([\w.-]{1,100})$/.exec(p);
  if (pm && req.method === "GET") {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const ids = partiesFor(db, s.who);
    if (!ids.length) return send(404, { error: "not_found" });
    const mine = new Set(db.prepare(`SELECT blob FROM portal_receipts WHERE party IN (${ids.map(() => "?").join(",")})`).all(...ids).map(r => r.blob));
    for (const a of account(db, ids)) { for (const e of a.ent) for (const l of e.lines || []) if (l.photo) mine.add(l.photo); for (const o of a.orders) for (const it of o.items) if (it.photo) mine.add(it.photo); for (const w of a.work) if (w.photo) mine.add(w.photo); }
    const row = mine.has(pm[1]) && db.prepare("SELECT type, bytes FROM blobs WHERE id = ?").get(pm[1]);
    if (!row) return send(404, { error: "not_found" });
    res.writeHead(200, { "Content-Type": /^image\//.test(row.type) ? row.type : "application/octet-stream", "Content-Security-Policy": "sandbox; default-src 'none'" });
    return res.end(Buffer.from(row.bytes));
  }

  // a party's own receipts, so it can see which ones Leon has recorded (the photo itself through /photo/:blob)
  if (p === "/api/portal/receipts/mine" && req.method === "GET") {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const ids = partiesFor(db, s.who);
    if (!ids.length) return send(403, { error: "no_account" });
    const rows = db.prepare(`SELECT id, blob, amount, date, ts, status FROM portal_receipts WHERE party IN (${ids.map(() => "?").join(",")}) ORDER BY ts DESC LIMIT 50`).all(...ids);
    return send(200, { receipts: rows });
  }

  // the owner reviews pending receipts and, after recording the real document in the ledger by hand, marks one done
  if (p === "/api/portal/receipts" && req.method === "GET") {
    if (!owner()) return send(401, { error: "login" });
    const names = Object.fromEntries(all(db, "parties").map(x => [x.id, x.name || ""]));
    const rows = db.prepare("SELECT * FROM portal_receipts ORDER BY ts DESC LIMIT 200").all();
    return send(200, { receipts: rows.map(r => ({ id: r.id, party: r.party, partyName: names[r.party] || "", blob: r.blob, amount: r.amount, date: r.date, ts: r.ts, status: r.status })) });
  }
  const dm = /^\/api\/portal\/receipt\/([\w-]{1,80})\/done$/.exec(p);
  if (dm && POST) {
    if (!owner()) return send(401, { error: "login" });
    db.prepare("UPDATE portal_receipts SET status = 'done' WHERE id = ?").run(dm[1]);
    return send(200, { ok: true });
  }

  // ---------- «ویترین»: the pieces the owner put on show in the ledger, for every signed-in party ----------
  // ---------- a supplier the owner allows (parties/<id>.upload, set in the ledger) adds and edits its own pieces (owner,
  // 2026-11-10): they land in the ledger's showcase as «در انتظار تایید» and nobody sees them until the owner sets the
  // wage and shows them. It never sees anyone else's pieces, nor Leon's wage, profit or price. ----------
  if (p.startsWith("/api/portal/studio/") && POST) {
    const s = portalSession(db, req), pid = s && partiesFor(db, s.who)[0], pd = pid && partyDoc(db, pid);
    if (!pid) return send(401, { error: "login" });
    if (!pd || pd.upload !== true) return send(403, { error: "no_upload" });
    const b = await json(req), now = new Date().toISOString();
    if (p === "/api/portal/studio/media") {
      if (tooMany("studio-media:" + pid, 200, 24 * 3600e3)) return send(429, { error: "too_many" });
      const m = /^data:((?:image\/(?:jpeg|png|webp))|(?:video\/(?:mp4|quicktime|webm)));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || ""));
      if (!m) return send(400, { error: "bad_type" });
      const bytes = Buffer.from(m[2], "base64"), video = m[1].startsWith("video/");
      if (bytes.length > (video ? STUDIO_VIDEO : STUDIO_IMAGE)) return send(413, { error: "too_large" });
      const id = "vp" + crypto.randomBytes(10).toString("hex");
      db.prepare("INSERT INTO blobs (id, type, bytes, rev) VALUES (?, ?, ?, 0)").run(id, m[1], bytes);
      return send(200, { ok: true, id, type: video ? "video" : "image" });
    }
    if (p === "/api/portal/studio/save") {
      if (tooMany("studio-save:" + pid, 100, 24 * 3600e3)) return send(429, { error: "too_many" });
      const id = String(b.id || ""), oldRow = id && db.prepare("SELECT data FROM docs WHERE col = 'vitrin' AND id = ? AND data IS NOT NULL").get(id), old = oldRow ? JSON.parse(oldRow.data) : null;
      if (id && (!old || old.supId !== pid)) return send(404, { error: "not_found" });
      const txt = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n), nm = (v, lo, hi) => { const x = +String(v ?? "").replace(/[٫/]/g, ".").replace(/[^\d.]/g, ""); return isFinite(x) && x >= lo && x <= hi ? x : null; };
      const name = txt(b.name, 80), weight = nm(digits(String(b.weight ?? "")), 0.01, 5000), carat = nm(digits(String(b.carat ?? "")), 300, 1000), supAjrat = String(b.supAjrat ?? "").trim() === "" ? null : nm(digits(String(b.supAjrat)), 0, 100);
      if (name.length < 2) return send(400, { error: "bad_name" });
      if (weight == null) return send(400, { error: "bad_weight" });
      const media = (Array.isArray(b.media) ? b.media : []).slice(0, 12).map(x => ({ id: String(x && x.id || ""), type: x && x.type === "video" ? "video" : "image" }))
        .filter(x => /^v[\w-]{1,60}$/.test(x.id) && ((old && (old.media || []).some(y => y.id === x.id)) || (x.id.startsWith("vp") && db.prepare("SELECT 1 FROM blobs WHERE id = ?").get(x.id))));
      if (!media.some(x => x.type === "image")) return send(400, { error: "no_photo" });
      const qty = Math.max(0, Math.min(999, Math.round(nm(digits(String(b.qty ?? "0")), 0, 999) || 0)));
      const nid = id || "vs" + crypto.randomBytes(8).toString("hex");
      const gks = new Set(vgroups(db).map(g => g.k)), pick = (Array.isArray(b.groups) ? b.groups : []).map(String).filter(k => gks.has(k)).slice(0, 8);
      const tags = [...(old && Array.isArray(old.tags) ? old.tags.filter(k => !gks.has(String(k))) : []), ...pick];
      const d = { ...(old || {}), name, cat: txt(b.cat, 30), tags, desc: txt(b.desc, 600), weight: Math.round(weight * 1000) / 1000, carat: Math.round(carat || 750), media, qty, stock: qty > 0 ? "qty" : "order",
        supId: pid, supName: pd.name || "", ...(supAjrat == null ? {} : { supAjrat }), portal: true, pending: true, pendingAt: now, ts: old && old.ts || now, ...(old ? {} : { show: false, ajrat: 0 }) };
      if (supAjrat == null) delete d.supAjrat;
      push([{ c: "vitrin", id: nid, d }], "portal");
      return send(200, { ok: true, id: nid });
    }
    if (p === "/api/portal/studio/cat") {
      if (tooMany("studio-cat:" + pid, 20, 24 * 3600e3)) return send(429, { error: "too_many" });
      const name = String(b.name ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24), key = catKey(name);
      if (key.length < 2) return send(400, { error: "bad_name" });
      const have = vcats(db).find(c => catKey(c.name) === key || (c.alias || []).some(a => catKey(a) === key));
      if (have) return send(200, { ok: true, cat: have.name, exists: true });
      const reqs = catReqs(db), mine = reqs.filter(x => x.by === pid), same = reqs.find(x => catKey(x.name) === key);
      if (same && same.by === pid) return send(200, { ok: true, cat: same.name, pending: true });
      if (same) return send(200, { ok: true, cat: same.name, pending: true });   // another supplier asked first: the same name joins that request
      if (mine.length >= 5) return send(429, { error: "too_many_cats" });
      push([{ c: "settings", id: "vcq_" + crypto.randomBytes(6).toString("hex"), d: { kind: "vcatreq", name, by: pid, byName: pd.name || "", at: now } }], "portal");
      return send(200, { ok: true, cat: name, pending: true });
    }
    if (p === "/api/portal/studio/remove") {
      const id = String(b.id || ""), row = db.prepare("SELECT data FROM docs WHERE col = 'vitrin' AND id = ? AND data IS NOT NULL").get(id), old = row ? JSON.parse(row.data) : null;
      if (!old || old.supId !== pid) return send(404, { error: "not_found" });
      // never shown yet: gone; shown before: hidden at once, and the owner sees the request
      if (old.show === false && !old.site) push([{ c: "vitrin", id, d: null }], "portal");
      else push([{ c: "vitrin", id, d: { ...old, show: false, site: false, removed: true, pending: true, pendingAt: now } }], "portal");
      return send(200, { ok: true });
    }
    return send(404, { error: "not_found" });
  }
  if (p === "/api/portal/vitrin" && req.method === "GET") {
    const s = portalSession(db, req);
    if (!s || !partiesFor(db, s.who).length) return send(401, { error: "login" });
    const pid = partiesFor(db, s.who)[0], mine = minePieces(db, pid), ids = new Set(mine.map(x => x.id));
    // its own pieces only in «محصولات شما در لئون», never with a price in the showcase
    const myCats = catReqs(db).filter(x => x.by === pid).map(x => x.name);
    return send(200, { items: shownItems(db, pid).filter(x => !ids.has(x.id)), mine, cats: vcats(db), groups: vgroups(db), ...(myCats.length ? { myCats } : {}) });
  }
  const vm = /^\/api\/portal\/media\/([\w.-]{1,100})$/.exec(p);
  if (vm && req.method === "GET") {
    const s = portalSession(db, req);
    if (!s || !partiesFor(db, s.who).length) return send(401, { error: "login" });
    const pid = partiesFor(db, s.who)[0], ok = [...shownItems(db, pid), ...minePieces(db, pid)].some(it => it.media.some(m => m.id === vm[1]));
    const row = ok && db.prepare("SELECT type, bytes FROM blobs WHERE id = ?").get(vm[1]);
    if (!row) return send(404, { error: "not_found" });
    res.writeHead(200, { "Content-Type": /^(image|video)\//.test(row.type) ? row.type : "application/octet-stream", "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "private, max-age=86400" });
    return res.end(Buffer.from(row.bytes));
  }
  // an order for a piece on show: it lands in the management panel's «سفارش‌ها» as a new lead, with the party attached
  if (p === "/api/portal/vitrin/order" && POST) {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const party = all(db, "parties").find(x => partiesFor(db, s.who).includes(x.id));
    if (!party) return send(403, { error: "no_account" });
    if (tooMany("order:" + party.id, 10, 24 * 3600e3)) return send(429, { error: "too_many" });
    const b = await json(req), it = shownItems(db, party.id).find(x => x.id === String(b.id || ""));
    if (!it) return send(404, { error: "not_found" });
    if (it.stock === "none") return send(409, { error: "unavailable" });
    const id = "ld" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), note = String(b.note || "").slice(0, 500);
    // (owner, 2026-11-09) the order waits ORDER_WAIT seconds for Leon to confirm it in the ledger; the price the buyer saw
    // (gold rate and total) goes with it and follows the rate while it waits
    const exp = Date.now() + ORDER_WAIT * 1000, price = priceIn(b);
    push([{ c: "crm_leads", id, d: { id, name: party.name || "", phone: party.phone || "", partyId: party.id, what: it.name + (it.code ? " (" + it.code + ")" : ""), note, source: "حساب من", status: "waiting", exp: new Date(exp).toISOString(), ...(price ? { price } : {}), ts: new Date().toISOString() } }], "portal");
    return send(200, { ok: true, id, exp, wait: ORDER_WAIT });
  }
  // the buyer's page asks how its order stands: confirmed by Leon, still waiting (with the seconds left), or past its time
  const om = /^\/api\/portal\/vitrin\/order\/([\w-]{1,60})(\/price)?$/.exec(p);
  if (om) {
    const s = portalSession(db, req), pid = s && partiesFor(db, s.who)[0];
    if (!pid) return send(401, { error: "login" });
    const r = db.prepare("SELECT data FROM docs WHERE col = 'crm_leads' AND id = ? AND data IS NOT NULL").get(om[1]), l = r && JSON.parse(r.data);
    if (!l || l.partyId !== pid) return send(404, { error: "not_found" });
    const left = Math.max(0, Math.ceil((Date.parse(l.exp || 0) - Date.now()) / 1000));
    let status = l.status === "waiting" ? (left > 0 ? "waiting" : "expired") : l.status === "expired" ? "expired" : "confirmed";
    if (l.status === "waiting" && status === "expired") push([{ c: "crm_leads", id: om[1], d: { ...l, status: "expired" } }], "portal");
    // the gold rate moved while it waited: the new price goes to the ledger with it
    if (om[2] && POST) {
      if (status !== "waiting") return send(409, { error: "not_waiting", status });
      if (tooMany("oprice:" + om[1], 20, 3600e3)) return send(429, { error: "too_many" });
      const price = priceIn(await json(req));
      if (!price) return send(400, { error: "bad_price" });
      push([{ c: "crm_leads", id: om[1], d: { ...l, price: { ...price, changed: true } } }], "portal");
      return send(200, { ok: true, status, left });
    }
    if (req.method !== "GET") return send(404, { error: "not_found" });
    return send(200, { status, left, price: l.price || null });
  }

  // the party ticks «خواندم و می‌پذیرم» under the rules: the text it was shown is kept once by its hash, and each
  // acceptance with the server's time, the address it came from and the browser, as its electronic signature
  if (p === "/api/portal/terms/accept" && POST) {
    const s = portalSession(db, req), id = s && partiesFor(db, s.who)[0];
    if (!id) return send(401, { error: "login" });
    const b = await json(req), text = String(b.text || ""), label = String(b.label || "").slice(0, 300);
    if (text.length < 20 || text.length > 60000 || !label) return send(400, { error: "bad_terms" });
    const hash = sha(text), at = Date.now();
    db.prepare("INSERT OR IGNORE INTO portal_terms (hash, text, first) VALUES (?, ?, ?)").run(hash, text, at);
    db.prepare("INSERT INTO portal_accepts (party, hash, label, at, ip, ua) VALUES (?, ?, ?, ?, ?, ?)").run(id, hash, label, at, String(ip || "").slice(0, 64), String(req.headers["user-agent"] || "").slice(0, 300));
    return send(200, { ok: true, hash, at });
  }
  // the party's own details (none required)
  if (p === "/api/portal/info" && POST) {
    const s = portalSession(db, req), id = s && partiesFor(db, s.who)[0];
    if (!id) return send(401, { error: "login" });
    const data = cleanInfo(await json(req));
    db.prepare("INSERT INTO portal_info (party, data, at) VALUES (?, ?, ?) ON CONFLICT (party) DO UPDATE SET data = excluded.data, at = excluded.at").run(id, JSON.stringify(data), Date.now());
    return send(200, { ok: true, info: data });
  }
  // the owner (ledger) sees what a party wrote and every time it signed the rules, with the text it signed
  if (p === "/api/portal/party" && req.method === "GET") {
    if (!owner()) return send(401, { error: "login" });
    const id = String(new URL(req.url, "http://x").searchParams.get("id") || "");
    const accepts = db.prepare("SELECT a.at, a.ip, a.ua, a.label, a.hash, t.text FROM portal_accepts a JOIN portal_terms t ON t.hash = a.hash WHERE a.party = ? ORDER BY a.at DESC LIMIT 20").all(id);
    return send(200, { info: infoOf(db, id), accepts });
  }

  if (p === "/api/portal/me" && req.method === "GET") {
    const s = portalSession(db, req);
    if (!s) return send(401, { error: "login" });
    const accounts = account(db, partiesFor(db, s.who));
    if (!accounts.length) return send(403, { error: "no_account" });
    // all three VIP steps done: the owner hears it once, in the ledger's «اعلان‌های حساب من» (vip_ready/<party>); VIP stays the owner's call
    const told = db.prepare("SELECT 1 FROM docs WHERE col = 'vip_ready' AND id = ? AND data IS NOT NULL");
    const ready = accounts.filter(a => a.vipWay && a.vipWay.all && !told.get(a.id));
    if (ready.length) push(ready.map(a => ({ c: "vip_ready", id: a.id, d: { partyId: a.id, name: a.name, steps: a.vipWay.steps, ts: new Date().toISOString() } })), "portal");
    const at = db.prepare("SELECT max(at) AS at FROM docs WHERE col IN ('parties','invoices','settlements','orders')").get().at;
    // the username, when the party has one, so «حساب من» can offer to change the password
    const login = db.prepare("SELECT * FROM portal_logins WHERE party = ?").get(accounts[0].id);
    const ph = db.prepare("SELECT data FROM portal_photos WHERE party = ?").get(accounts[0].id);
    return send(200, { accounts, updated: at, terms: lastAccept(db, accounts[0].id), info: infoOf(db, accounts[0].id), ...(login ? { username: login.name, ...(ownPass(db, login) ? {} : { passNew: true }) } : {}), ...(ph ? { photo: ph.data } : {}) });
  }
  // its invite code and how many people signed up with it
  if (p === "/api/portal/invite" && req.method === "GET") {
    const s = portalSession(db, req), pid = s && partiesFor(db, s.who)[0];
    if (!pid) return send(401, { error: "login" });
    const joined = db.prepare("SELECT count(*) AS n FROM docs WHERE col = 'parties' AND data IS NOT NULL AND json_extract(data, '$.refBy') = ?").get(pid).n;
    return send(200, { code: inviteCode(db, pid), joined });
  }
  // its own profile photo: set (a JPEG/PNG/WebP up to AVATAR_MAX, already shrunk by the page) or removed
  if ((p === "/api/portal/avatar" || p === "/api/portal/avatar/remove") && POST) {
    const s = portalSession(db, req), pid = s && partiesFor(db, s.who)[0];
    if (!pid) return send(401, { error: "login" });
    if (p === "/api/portal/avatar/remove") { db.prepare("DELETE FROM portal_photos WHERE party = ?").run(pid); return send(200, { ok: true }); }
    if (tooMany("avatar:" + pid, 30, 24 * 3600e3)) return send(429, { error: "too_many" });
    const img = String((await json(req)).image || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) return send(400, { error: "bad_type" });
    if (img.length > AVATAR_MAX) return send(413, { error: "too_large" });
    db.prepare("INSERT INTO portal_photos (party, data, at) VALUES (?, ?, ?) ON CONFLICT (party) DO UPDATE SET data = excluded.data, at = excluded.at").run(pid, img, Date.now());
    return send(200, { ok: true, photo: img });
  }
  // push notifications: this party's own devices (notify.mjs)
  if (p.startsWith("/api/portal/push/")) {
    const s = p === "/api/portal/push/key" || p === "/api/portal/push/reach" ? null : portalSession(db, req);
    return notify.handle(req, p, s && partiesFor(db, s.who).length ? s.who : null, { send, json });
  }
  if (p === "/api/portal/logout" && POST) {
    const s = portalSession(db, req);
    if (s) db.prepare("DELETE FROM portal_sessions WHERE token = ?").run(s.token);
    return send(200, { ok: true });
  }
  return send(404, { error: "not_found" });
}
