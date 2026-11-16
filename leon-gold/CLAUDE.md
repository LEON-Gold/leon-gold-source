# Working on the Leon Gold ledger

- The owner writes in Persian and uses an iPhone (Safari). Reply in Persian, and keep the phone layout first-class.
- `index.html` is the whole app. The target is the phone app on GitHub Pages (https://leon-gold.github.io/leon-gold-app/): build with `offline/build.ps1 -Site ..\leon-gold-app`, then push that repo. The Artifact version is retired; don't publish there.
- Data lives in each device's IndexedDB, never in git. Devices share it through `../leon-gold-server` (sync panel in the «آفلاین» menu; `offline/runtime.js` queues changes in an outbox and pulls the others'). Without a connection the export/import menu still moves it by file.
- Act without asking first, then report. Test before every push (the phone app holds live business data).
- Ask before any irreversible change to live data.

## Business rules (do not break)

- **Gram balances never convert to rial at today's price.** Rial appears only from rial amounts written on an invoice.
- **Purity:**
  - Everywhere except the retail invoice, purity uses the lab number: 750 = 18 karat.
  - `labOf(c) = c<=24 ? c*1000/24 : c`
  - 750-equivalent grams = `w*lab/750`
- **Saved invoices are locked.**
  - Opening one never applies today's price.
  - «باز کردن قفل» allows one edit, and the previous version is logged and can be restored.
- **Mithqal** = gram18 price × 4.3318.
- **«آبشده شرطی»** has no purity yet. It counts as 750 until «تعیین عیار».

## UI decisions

- **Market price:** the owner wants an Iranian source. The «gold price» GitHub Action in leon-gold-app copies the Tehran gold union board (estjt.ir) 18k price into `price.json` on its `price` branch every 2 minutes (one run loops for ~6h; GitHub's schedule only restarts it, since it fires unreliably). The app reads it from raw.githubusercontent.com, then jsDelivr, and falls back to tgju if it's missing or over 40 minutes old. It's only a suggestion, never saved on its own.

- **Navigation:** a hamburger drawer (`#nav`). Add new sections as their own page plus a menu item. Home holds only what the owner asked for (on 2026-10-26 they added the «امروز» card); ask before putting anything else there.
- **New documents:** a floating gold «+» (`#fab`) opens a bottom sheet on every page except home and forms; on a party page it pre-selects that party.
- **Sync:** `build.ps1 -SyncUrl <server>` fills in the server address. Test with `node tests/sync.test.mjs` (two devices against a local server). The IndexedDB is version 2 (adds `outbox`, `meta`); an old v1 phone database upgrades in place.
- **Login:**
  - Per-user username plus numeric password, stored in `settings/lock.users[{u,hash,salt,photo}]`.
  - On the phone app this lock is the only access control, since the data never leaves the device.
- **Invoice export:**
  - PDF only (jsPDF plus html2canvas at up to 4x). Libraries load on demand through `loadLib()`: the phone site gets them from `lib/` (copied by build.ps1, precached by sw.js) so its first paint stays quick; the standalone offline file inlines them. A splash (`#splash`) shows until the first render.
  - The green top-left corner and the QR were removed because Safari rendered them blank. Don't re-add them without asking.
  - Persian text inside sheets needs `letter-spacing:0`, or html2canvas breaks the shaping.
- **Expenses («هزینه‌های مغازه»):** collection `expenses`, one doc per expense: `{date:'۱۴۰۵/۰۸/۰۵', cat, note, r (rial), w (grams as weighed), lab, g (750-equivalent = w*lab/750), ts, by?}`. `cat` is a key of `XCAT` (rent, wage, bills, work, melt, tools, pack, ship, ads, safe, tax, bank, hosp, other). Rial and gram totals stay apart and never convert; expenses touch no party balance. The report page subtracts gram expenses from wholesale gram profit and rial expenses from retail rial profit. The CRM panel reads them from the sync server. Test: `tests/expenses.test.js` (needs playwright or playwright-core on NODE_PATH plus installed Chrome).
- **Quick entry (2026-10-27):** on a new invoice the party section has a search (name, shop or phone, Persian or Latin digits) and one-tap chips of the parties with the latest documents; no match offers «افزودن … به طرف‌حساب‌ها», which opens the party form with the name filled and comes back with it selected. «مشخصات سند» (number, date, time/due, tax: all filled automatically) folds into one summary line (`foldSec`). Phone fields use `{tel:1}` (phone keypad).
- **Rounding:** a saved invoice moves a balance by exactly what it prints: `LGR` whole rials, `LGW` grams to 3 decimals (older saved invoices keep what they stored). Item `w750`/`ajratG`/`totalG` keep 6 decimals so the report's sums don't drift; display and Excel show 3. `tests/rounding.test.js` checks this; it reaches the app's sums through `window.__leon`, which exists only when index.html is opened as a `file:`.
- **«پنل مدیریت» (2026-10-31):** a ledger page (`admin`, party page `aparty`) in the menu for whoever is signed in (only the owner can sign in to the server, so `__leonSync.info().owner` is simply «has a token»). Per party: balances, open/late orders, invoices, receipts sent from «حساب من», and «خوش‌حسابی» from `payInfo()`: debts matched first-in first-out against payments, per unit; good = average ≤ 7 days and no open debt over 30 days, late = average over 30 days or an open debt over 60. The site's CRM panel (notes, occasions) opens from a button there. Test: `node tests/admin.test.mjs`.
- **«حساب من» sign-in:** «کاربران» › مشتریان و تأمین‌کنندگان makes each party a starting username (its mobile, else `leon` + 4 digits) and a 6-digit password (one by one, or «برای همه»), shown once to send by WhatsApp or copy; the party changes it in «حساب من». The server keeps only a hash, so a forgotten password is renewed, never shown.
- **«ویترین» (2026-11-01):** menu item and page (`vitrin`, form `vform`, collection `vitrin`): the pieces every buyer sees in «حساب من». Photos (shrunk to 1600px) and films (≤80 MB) upload straight to the server (`PUT /api/media/:id`), are never stored on the devices, and show in the ledger through `GET /api/media/:id`. Price in «حساب من» = gold at the hour's rate + wage % + profit % + 10% tax on both. Orders from there arrive as panel leads. Test: `node tests/vitrin.test.mjs`.
