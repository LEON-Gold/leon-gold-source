// Rounding of rial and gram totals: what a saved invoice adds to a balance must be exactly what it prints
// (whole rials, grams to 3 decimals), line weights keep their precision for the report, and balances, expenses
// and the report's profit after expenses add up without drift. Mock storage only; prints FAIL lines on error.
let pw; try { pw = require('playwright') } catch (e) { pw = require('playwright-core') }
const path = require('path');
(async () => {
  const b = await pw.chromium.launch({ channel: 'chrome' }).catch(() => pw.chromium.launch());
  const pg = await (await b.newContext({ viewport: { width: 390, height: 780 } })).newPage();
  const errs = [], fail = m => { errs.push(m); console.log('FAIL', m) }, ok = m => console.log('ok  ', m);
  pg.on('pageerror', e => fail(e.message));
  await pg.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await pg.addInitScript(() => { const store = { parties: { p1: { name: 'همکار', kind: 'both', ts: '2026-10-01T00:00:00Z' } } }; const subs = {}; let n = 0; window.__store = store;
    const emit = c => (subs[c] || []).forEach(f => f({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })) }));
    const db = { collection: c => ({ doc: id => ({ id: id || 'x' + (++n), set: async d => { (store[c] = store[c] || {})[id] = d; setTimeout(() => emit(c)) }, update: async () => {}, delete: async () => { delete (store[c] || {})[id]; setTimeout(() => emit(c)) } }), onSnapshot: f => { (subs[c] = subs[c] || []).push(f); setTimeout(() => emit(c)) } }) };
    window.claude = { use: async n => n === 'db' ? db : n === 'user' ? { me: async () => ({ name: 'علی', isOwner: true }), can: async () => true } : null }; });
  await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(700);
  const dec = (v, d) => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6;

  // wholesale: three 0.001 g lines at 740 and one 3.27 g line at 17.5 karat, 7% wage
  async function newInv(k) { await pg.evaluate(k => __leon.openNewInvoice(k, ''), k); await pg.waitForTimeout(300);
    await pg.selectOption('#partySel', 'p1'); await pg.waitForTimeout(200) }
  const fill = (sel, rows) => pg.evaluate(([sel, rows]) => { const trs = document.querySelectorAll(sel + ' tbody tr');
    rows.forEach((r, i) => Object.entries(r).forEach(([c, v]) => { const e = trs[i].querySelector('.' + c); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) })) }, [sel, rows]);
  await newInv('whole');
  await fill('#wt', [{ w: '0.001', c: '740' }, { w: '0.001', c: '740' }, { w: '0.001', c: '740' }, { w: '3.27', c: '17.5', aj: '7' }]);
  await pg.waitForTimeout(200);
  const W = await pg.evaluate(() => window.LGW);
  dec(W.eff, 3) && dec(W.delta, 3) ? ok('wholesale amounts are whole thousandths: ' + W.eff + ' / ' + W.delta) : fail('wholesale not rounded to 3 decimals: ' + W.eff + ' / ' + W.delta);
  await pg.click('#saveInv'); await pg.waitForTimeout(500);
  const wi = await pg.evaluate(() => Object.values(window.__store.invoices).find(i => i.kind === 'whole'));
  const exact = 0.003 * 740 / 750 + 3.27 * (17.5 * 1000 / 24) / 750, sumW = wi.items.reduce((a, it) => a + it.w750, 0);
  Math.abs(sumW - exact) < 1e-5 ? ok('line weights keep precision for the report: ' + sumW.toFixed(6) + ' vs ' + exact.toFixed(6)) : fail('line weights rounded too early: ' + sumW + ' vs ' + exact);
  Math.abs(wi.deltaG - Math.round((exact + 3.27 * (17.5 * 1000 / 24) / 750 * 0.07) * 1000) / 1000) < 1e-9 ? ok('balance gets the printed gram total ' + wi.deltaG) : fail('deltaG ' + wi.deltaG);

  // retail: a price and percents that leave fractions of a rial
  await newInv('retail');
  await pg.evaluate(() => { const g = document.querySelector('#retail .gp'); g.value = '70000001'; g.dispatchEvent(new Event('input', { bubbles: true })) });
  await fill('#rt', [{ w: '1.337', aj: '7', pf: '3' }, { w: '2.111', aj: '12.5', pf: '4' }]); await pg.waitForTimeout(200);
  const R = await pg.evaluate(() => window.LGR);
  Number.isInteger(R.eff) && Number.isInteger(R.delta) ? ok('retail amounts are whole rials: ' + R.eff) : fail('retail fractions of a rial: ' + R.eff + ' / ' + R.delta);
  const shown = await pg.evaluate(() => document.querySelector('#s_final').textContent);
  await pg.click('#saveInv'); await pg.waitForTimeout(500);
  const ri = await pg.evaluate(() => Object.values(window.__store.invoices).find(i => i.kind === 'retail'));
  const shownN = +shown.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d]/g, '');
  ri.deltaR === shownN ? ok('balance gets the printed rial total ' + ri.deltaR) : fail('deltaR ' + ri.deltaR + ' vs printed ' + shownN);

  // balances: many small documents that cancel exactly; big rials
  const bal = await pg.evaluate(() => { const { S, compute } = __leon; S.settlements = []; for (let i = 0; i < 1000; i++) S.settlements.push({ partyId: 'p1', dir: i % 2 ? 'in' : 'out', unit: 'g', amount: i % 2 ? 0.003 : 0.001 * 3, ts: 'z' + i });
    S.settlements.push({ partyId: 'p1', dir: 'out', unit: 'r', amount: 9e14, ts: 'zz' }, { partyId: 'p1', dir: 'in', unit: 'r', amount: 9e14 - 1, ts: 'zzz' });
    S.invoices = []; compute(); return S.bal.p1 });
  Math.abs(bal.g) < 0.0005 && bal.r === 1 ? ok('1000 small gram docs net to zero; 900 trillion rial docs keep the 1 rial') : fail('balance ' + JSON.stringify(bal));

  // expenses and profit after expenses: rial stays whole, grams add without drift
  const ex = await pg.evaluate(() => { const { S, expSum, todayD, jdate } = __leon; S.expenses = []; for (let i = 0; i < 100; i++) S.expenses.push({ date: jdate(Date.now()), cat: 'melt', r: 1250000, w: 0.01, lab: 740, g: 0.01 * 740 / 750, ts: 'e' + i });
    const d = todayD(), T = expSum(d, d); return T });
  ex.r === 125000000 && Math.abs(ex.g - 100 * 0.01 * 740 / 750) < 1e-9 ? ok('100 expenses: ' + ex.r + ' rial, ' + ex.g.toFixed(6) + ' g') : fail('expenses ' + JSON.stringify(ex));

  // a receipt/payment document moves the balance by what it prints too: grams to 3 decimals, whole rials
  const st = await pg.evaluate(async () => { const { go, saveSet } = __leon; const out = [];
    for (const [u, a] of [['g', '2.34567'], ['r', '1000.6']]) { go('set', { partyId: 'p1' }); await new Promise(r => setTimeout(r, 200));
      document.querySelector('#sf_unit').value = u; document.querySelector('#sf_amt').value = a; await saveSet(); out.push(Object.values(window.__store.settlements || {}).pop().amount) } return out });
  st[0] === 2.346 && st[1] === 1001 ? ok('settlement amounts rounded: ' + st) : fail('settlement amounts ' + st);

  console.log(errs.length ? 'FAILED ' + errs.length : 'all passed'); await b.close(); process.exit(errs.length ? 1 : 0);
})();
