// Bank SMS into the ledger (owner, 2026-11-15): an iPhone Shortcuts automation sends each message from Mellat or Saman
// here with a private key; the server reads the amount, in or out, the account and the balance, and files it as a
// «bankmsgs» document the ledger shows in «نقدینگی و بانک», where the owner writes what it was for. The text itself is
// kept too (the formats vary), and no key is stored, only its hash.
import crypto from "node:crypto";

const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
export const latinDigits = s => String(s || "").replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
// the two accounts (card and Sheba ends from the invoices) to know the bank when the message does not name it
const ENDS = { mellat: ["0802", "9060005609"], saman: ["8451", "5530372901"] };

// a number written with thousands separators or plain, at least 4 digits, as rials
const NUM = "([+-]?\\s*\\d{1,3}(?:[,٬]\\d{3})+|[+-]?\\s*\\d{4,})";
const toN = s => +String(s).replace(/[\s,٬+]/g, "").replace(/^-/, "") || 0;
export function parse(text) {
  const t = latinDigits(text).replace(/‌/g, " "), out = { bank: "", dir: "", amount: 0, bal: null };
  out.bank = /ملت|mellat/i.test(t) ? "mellat" : /سامان|saman|بلو|\bblu\b/i.test(t) ? "saman"
    : ENDS.mellat.some(e => t.includes(e)) ? "mellat" : ENDS.saman.some(e => t.includes(e)) ? "saman" : "";
  const bal = new RegExp("(?:مانده|موجودی|balance)\\s*[:：]?\\s*" + NUM, "i").exec(t);
  if (bal) out.bal = toN(bal[1]);
  // the amount: after a word that says what happened, else a signed number, else the first long number that is not the balance
  const tagged = new RegExp("(برداشت|خرید|انتقال|پرداخت|کسر|واریز|افزایش|مبلغ|withdraw|deposit|amount)[^\\d+\\-]{0,12}" + NUM, "i").exec(t);
  const signed = /(^|[\s:])([+-])\s*(\d{1,3}(?:[,٬]\d{3})+|\d{4,})/.exec(t);
  if (tagged) out.amount = toN(tagged[2]);
  else if (signed) out.amount = toN(signed[3]);
  else { const all = [...t.matchAll(new RegExp(NUM, "g"))].map(m => m[1]).filter(m => !bal || toN(m) !== out.bal); if (all.length) out.amount = toN(all[0]); }
  // in or out
  if (/واریز|افزایش|deposit|به حساب شما|\+\s*\d/i.test(t)) out.dir = "in";
  if (/برداشت|خرید|کسر|پرداخت|withdraw|از حساب شما|(^|[\s:])-\s*\d/i.test(t)) out.dir = "out";
  if (!out.dir && /انتقال/.test(t)) out.dir = "out";
  // the message's own date and time, as Mellat writes it: 05/08/20-12:17 (year 1405) or 1405/08/20 12:17
  const dt = /(\d{2}|\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-–\s]\s*(\d{1,2}):(\d{2})/.exec(t);
  const z = n => String(n).padStart(2, "0");
  if (dt) { const y = dt[1].length === 2 ? 1400 + +dt[1] : +dt[1]; out.date = `${y}/${z(dt[2])}/${z(dt[3])}`; out.time = `${z(dt[4])}:${dt[5]}`; }
  else {
    // Blu: the date with dots on one line (1405.08.24), the time on another (22:52)
    const d2 = /(1[34]\d{2})[./](\d{1,2})[./](\d{1,2})/.exec(t), t2 = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/.exec(t);
    if (d2) out.date = `${d2[1]}/${z(d2[2])}/${z(d2[3])}`;
    if (t2) out.time = `${z(t2[1])}:${t2[2]}`;
  }
  return out;
}

export function setKey(db) {
  const k = crypto.randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO meta (k, v) VALUES ('banksms_key', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(sha(k));
  return k;
}
export function keyOk(db, k) {
  const h = db.prepare("SELECT v FROM meta WHERE k = 'banksms_key'").get()?.v;
  if (!h || !k) return false;
  const a = Buffer.from(h, "hex"), b = Buffer.from(sha(k), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// one message → the document the ledger reads
export function doc(text, now = Date.now()) {
  const tx = String(text || "").slice(0, 600), p = parse(tx);
  return { id: "bm" + now.toString(36) + crypto.randomBytes(3).toString("hex"), d: { ts: new Date(now).toISOString(), text: tx, ...p } };
}
