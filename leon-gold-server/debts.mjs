// The week's debts, for the owner only (owner, 2026-11-15): every Saturday from 10:00 Tehran time one ledger
// notification lists who owes Leon (a party's balance above zero, in grams or rials, as the ledger counts it) with the
// largest first. Sent once a week (meta key «debts_week»), only to ledger users with no limit on what they may see.
import { account } from "./portal.mjs";

const fa = s => String(s).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[d]);
const grams = g => fa((Math.round(g * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 }).replace(/,/g, "٬").replace(".", "٫"));
const rials = r => fa(Math.round(r).toLocaleString("en-US").replace(/,/g, "٬"));

// Tehran's weekday (0 = Sunday … 6 = Saturday), hour and date, whatever the server's own clock zone is
export function tehran(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map(x => [x.type, x.value]));
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: +p.hour, date: `${p.year}-${p.month}-${p.day}` };
}

export function debtors(db) {
  const ids = db.prepare("SELECT id FROM docs WHERE col = 'parties' AND data IS NOT NULL").all().map(r => r.id);
  return account(db, ids).map(a => ({ name: a.name || "—", g: a.bal.g, r: a.bal.r }))
    .filter(a => a.g >= 0.0005 || a.r >= 0.5)
    .sort((a, b) => (b.g * 50 + b.r / 1e6) - (a.g * 50 + a.r / 1e6));
}

export function message(list) {
  if (!list.length) return { title: "یادآوری هفتگی بدهی‌ها", body: "این هفته کسی به لئون گلد بدهکار نیست." };
  const G = list.reduce((s, a) => s + Math.max(0, a.g), 0), R = list.reduce((s, a) => s + Math.max(0, a.r), 0);
  const one = a => a.name + " (" + [a.g >= 0.0005 ? grams(a.g) + " گرم" : "", a.r >= 0.5 ? rials(a.r) + " ریال" : ""].filter(Boolean).join(" و ") + ")";
  const top = list.slice(0, 5).map(one).join("، "), more = list.length > 5 ? " و " + fa(list.length - 5) + " نفر دیگر" : "";
  return { title: "یادآوری هفتگی بدهی‌ها · " + fa(list.length) + " بدهکار",
    body: "جمع: " + [G ? grams(G) + " گرم" : "", R ? rials(R) + " ریال" : ""].filter(Boolean).join(" و ") + ". " + top + more };
}

// called every few minutes; sends at most once per Saturday
export function weekly(db, tellOwners, now = new Date()) {
  const t = tehran(now);
  if (t.day !== 6 || t.hour < 10) return false;
  if (db.prepare("SELECT v FROM meta WHERE k = 'debts_week'").get()?.v === t.date) return false;
  db.prepare("INSERT INTO meta (k, v) VALUES ('debts_week', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(t.date);
  tellOwners(message(debtors(db)), "parties");
  return true;
}
