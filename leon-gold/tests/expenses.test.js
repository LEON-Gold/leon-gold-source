// Expenses page at phone width: add, auto-fill last amount of a type, month totals kept apart, report section. Prints FAIL lines on error.
// playwright, or playwright-core (NODE_PATH) driving the installed Chrome
let pw; try { pw = require('playwright') } catch (e) { pw = require('playwright-core') }
const chromium = { launch: () => pw.chromium.launch({ channel: 'chrome' }).catch(() => pw.chromium.launch()) };
const path = require('path'), out = process.env.SHOTS || path.join(require('os').tmpdir(), 'leon-shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 780 } }); const pg = await ctx.newPage();
  const errs = [], fail = m => { errs.push(m); console.log('FAIL', m) }; pg.on('pageerror', e => fail(e.message));
  await pg.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await pg.addInitScript(() => { const store = {}; const subs = {}; let n = 0; window.__store = store;
    const emit = c => (subs[c] || []).forEach(f => f({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, data: () => d })) }));
    const db = { collection: c => ({ doc: id => ({ id: id || 'x' + (++n), set: async d => { (store[c] = store[c] || {})[id] = d; setTimeout(() => emit(c)) }, delete: async () => { delete (store[c] || {})[id]; setTimeout(() => emit(c)) } }), onSnapshot: f => { (subs[c] = subs[c] || []).push(f); setTimeout(() => emit(c)) } }) };
    window.claude = { use: async n => n === 'db' ? db : n === 'user' ? { me: async () => ({ name: 'علی', isOwner: true }), can: async () => true } : null }; });
  await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(600);
  await pg.click('#menuBtn'); await pg.waitForTimeout(300); await pg.click('#nav [data-tab="expenses"]'); await pg.waitForTimeout(300);
  if ((await pg.textContent('#topTitle')).indexOf('هزینه') < 0) fail('no expenses page');
  await pg.screenshot({ path: out + '/x0-empty.png', fullPage: true });
  // first rent: 500,000,000 rial
  await pg.click('#fab'); await pg.waitForTimeout(200); await pg.click('.asheet [data-act="newx"]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="xcat"][data-k="rent"]'); await pg.fill('#x_r', '۵۰۰۰۰۰۰۰۰'); await pg.dispatchEvent('#x_r', 'input');
  if ((await pg.textContent('#x_rw')).indexOf('تومان') < 0) fail('no toman line');
  await pg.screenshot({ path: out + '/x1-form.png', fullPage: true });
  await pg.click('[data-act="savex"]'); await pg.waitForTimeout(400);
  // second: tapping rent again fills 500,000,000
  await pg.click('[data-act="newx"]'); await pg.waitForTimeout(300); await pg.click('[data-act="xcat"][data-k="rent"]');
  if (await pg.inputValue('#x_r') !== '۵۰۰۰۰۰۰۰۰') fail('auto-fill: ' + await pg.inputValue('#x_r'));
  await pg.click('[data-act="back"]'); await pg.waitForTimeout(300);
  // a gold expense: 2 g of 18 karat (lab 750) and 1 g at 900 → 2 + 1.2 = 3.2 g 750
  await pg.click('[data-act="newx"]'); await pg.waitForTimeout(300); await pg.click('[data-act="xcat"][data-k="melt"]');
  await pg.fill('#x_w', '2'); await pg.fill('#x_lab', '18'); await pg.fill('#x_note', 'افت ذوب'); await pg.click('[data-act="savex"]'); await pg.waitForTimeout(400);
  await pg.click('[data-act="newx"]'); await pg.waitForTimeout(300); await pg.click('[data-act="xcat"][data-k="work"]');
  await pg.fill('#x_w', '1'); await pg.fill('#x_lab', '900'); await pg.click('[data-act="savex"]'); await pg.waitForTimeout(400);
  // validation: no type
  await pg.click('[data-act="newx"]'); await pg.waitForTimeout(300); await pg.fill('#x_r', '100'); await pg.click('[data-act="savex"]'); await pg.waitForTimeout(200);
  if ((await pg.textContent('#toast')).indexOf('نوع هزینه') < 0) fail('no type check');
  await pg.click('[data-act="back"]'); await pg.waitForTimeout(300);
  const st = await pg.evaluate(() => Object.values(window.__store.expenses || {}));
  if (st.length !== 3) fail('saved ' + st.length);
  const g = st.reduce((a, x) => a + x.g, 0), r = st.reduce((a, x) => a + x.r, 0);
  if (Math.abs(g - 3.2) > 1e-9 || r !== 500000000) fail('sums ' + g + ' ' + r);
  if (st.some(x => !x.date || !x.cat || x.lab == null || !x.ts)) fail('fields ' + JSON.stringify(st));
  const kp = await pg.textContent('.kpis'); console.log('kpis:', kp.replace(/\s+/g, ' '));
  if (kp.indexOf('۵۰۰٬۰۰۰٬۰۰۰') < 0 || kp.indexOf('۳٫۲') < 0) fail('kpi text');
  await pg.screenshot({ path: out + '/x2-list.png', fullPage: true });
  // previous month is empty; next is disabled
  await pg.click('[data-act="xoff"][data-n="-1"]'); await pg.waitForTimeout(200);
  if ((await pg.$$('main .list .row')).length) fail('previous month not empty');
  await pg.click('[data-act="xoff"][data-n="1"]'); await pg.waitForTimeout(200);
  // edit then delete the work one
  const rows = await pg.$$('main .list .row'); if (rows.length !== 3) fail('rows ' + rows.length);
  // report shows the expense section
  await pg.click('#menuBtn'); await pg.waitForTimeout(300); await pg.click('#nav [data-tab="report"]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="rpk"][data-k="m"]'); await pg.waitForTimeout(200);
  const rp = await pg.textContent('main'); if (rp.indexOf('سود عمده بعد از هزینه‌ی طلایی') < 0) fail('report section');
  await pg.screenshot({ path: out + '/x3-report.png', fullPage: true });
  // 22 karat (lab 916.67) edited without touching purity keeps its grams: the form must not round the lab number
  await pg.click('#menuBtn'); await pg.waitForTimeout(300); await pg.click('#nav [data-tab="expenses"]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="newx"]'); await pg.waitForTimeout(300); await pg.click('[data-act="xcat"][data-k="tools"]');
  await pg.fill('#x_w', '100'); await pg.fill('#x_lab', '22'); await pg.click('[data-act="savex"]'); await pg.waitForTimeout(400);
  const g22 = await pg.evaluate(() => Object.values(window.__store.expenses).find(x => x.cat === 'tools').g);
  await pg.click('main .list .row:has-text("ابزار")'); await pg.waitForTimeout(300); await pg.click('[data-act="savex"]'); await pg.waitForTimeout(400);
  const g22b = await pg.evaluate(() => Object.values(window.__store.expenses).find(x => x.cat === 'tools').g);
  if (Math.abs(g22b - g22) > 1e-9 || Math.abs(g22 - 100 * 916.6666666666666 / 750) > 1e-6) fail('22k edit drift ' + g22 + ' ' + g22b);
  const wide = await pg.evaluate(() => document.documentElement.scrollWidth); if (wide > 390) fail('horizontal scroll ' + wide);
  console.log(errs.length ? 'FAILED ' + errs.length : 'ok', 'shots in', out); await b.close(); process.exit(errs.length ? 1 : 0);
})();
