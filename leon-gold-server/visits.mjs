// The site's visits (owner, 2026-11-15): each page of the public site sends one hit (its path); the server keeps per day
// the views of each page and a one-way mark of each visitor (address + browser + the day, hashed with a secret kept in
// the database: no address, browser or person is stored, and the mark changes every day). The ledger reads the sums.
import crypto from "node:crypto";

export function setup(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS visit_pages (day TEXT NOT NULL, path TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, path));
           CREATE TABLE IF NOT EXISTS visit_people (day TEXT NOT NULL, h TEXT NOT NULL, last INTEGER NOT NULL, PRIMARY KEY (day, h));`);
  if (!db.prepare("SELECT 1 FROM meta WHERE k = 'visit_salt'").get())
    db.prepare("INSERT INTO meta (k, v) VALUES ('visit_salt', ?)").run(crypto.randomBytes(16).toString("hex"));
}

// the day in Tehran, YYYY-MM-DD
export const dayOf = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));

// a page path worth counting: the site's own pages only (not the panel, the ledger or the API), short, plain
export function cleanPath(p) {
  p = String(p || "").split(/[?#]/)[0].replace(/\/leon-gold-app\/site(?=\/)/, "").replace(/\/index\.html$/, "/");
  if (!/^\/[\w\-./%؀-ۿ]{0,80}$/.test(p) || /^\/(panel|daftar|api|apps|_next)(\/|$)/.test(p)) return null;
  return p.endsWith("/") ? p : p + "/";
}

export function hit(db, path, ip, ua, now = Date.now()) {
  const p = cleanPath(path); if (!p) return false;
  const day = dayOf(now), salt = db.prepare("SELECT v FROM meta WHERE k = 'visit_salt'").get().v;
  const h = crypto.createHash("sha256").update(salt + "|" + day + "|" + ip + "|" + String(ua || "").slice(0, 200)).digest("hex").slice(0, 20);
  db.prepare("INSERT INTO visit_pages (day, path, n) VALUES (?, ?, 1) ON CONFLICT (day, path) DO UPDATE SET n = n + 1").run(day, p);
  db.prepare("INSERT INTO visit_people (day, h, last) VALUES (?, ?, ?) ON CONFLICT (day, h) DO UPDATE SET last = excluded.last").run(day, h, now);
  return true;
}

// the sums for the ledger: today, the last 7 days (oldest first), visitors in the last 5 minutes, the most seen pages
export function stats(db, now = Date.now()) {
  const days = []; for (let i = 6; i >= 0; i--) days.push(dayOf(now - i * 864e5));
  const views = Object.fromEntries(db.prepare(`SELECT day, sum(n) AS n FROM visit_pages WHERE day >= ? GROUP BY day`).all(days[0]).map(r => [r.day, r.n]));
  const people = Object.fromEntries(db.prepare(`SELECT day, count(*) AS n FROM visit_people WHERE day >= ? GROUP BY day`).all(days[0]).map(r => [r.day, r.n]));
  const week = days.map(d => ({ day: d, views: views[d] || 0, visitors: people[d] || 0 }));
  const top = db.prepare(`SELECT path, sum(n) AS n FROM visit_pages WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 6`).all(days[0]);
  const online = db.prepare(`SELECT count(*) AS n FROM visit_people WHERE last >= ?`).get(now - 5 * 60e3).n;
  return { today: week[6], week, online, top };
}

// kept 120 days
export function prune(db, now = Date.now()) {
  const d = dayOf(now - 120 * 864e5);
  db.prepare("DELETE FROM visit_pages WHERE day < ?").run(d); db.prepare("DELETE FROM visit_people WHERE day < ?").run(d);
}
