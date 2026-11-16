// Desktop side menu scrolls with a laptop trackpad/mouse wheel (owner, 2026-11-13): at 1440 and 1280 wide, a wheel over the
// menu scrolls the menu; once the menu is at its end, the page scrolls. At phone width the drawer still scrolls and keeps
// the page still behind it. Prints FAIL lines on error.
// node tests/menuscroll.test.js   (playwright, or playwright-core on NODE_PATH, driving the installed Chrome)
let pw; try { pw = require('playwright') } catch (e) { pw = require('playwright-core') }
const chromium = { launch: () => pw.chromium.launch({ channel: 'chrome' }).catch(() => pw.chromium.launch()) };
const path = require('path');
let fails = 0; const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : '')); if (!ok) fails++ };
const shim = () => { const db = { collection: () => ({ doc: id => ({ id, set: async () => {}, delete: async () => {} }), onSnapshot: f => { setTimeout(() => f({ docs: [] })); return () => {} } }) };
  window.claude = { use: async n => n === 'db' ? db : n === 'user' ? { me: async () => ({ name: 'test', isOwner: true }), can: async () => true } : null } };
const st = pg => pg.evaluate(() => { const n = document.getElementById('nav'); return { top: Math.round(n.scrollTop), max: n.scrollHeight - n.clientHeight, page: Math.round(scrollY) } });

(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1440, 700], [1280, 640]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort()); await pg.addInitScript(shim);
    await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(900);
    await pg.evaluate(() => { document.body.style.minHeight = '3000px' }); // a page long enough to scroll after the menu
    let s = await st(pg); check(`${w}: the menu is taller than the window`, s.max > 20, `overflow ${s.max}px`);
    const box = await (await pg.$('#nav')).boundingBox(); await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pg.mouse.wheel(0, 120); await pg.waitForTimeout(250); s = await st(pg);
    check(`${w}: a wheel over the menu scrolls the menu`, s.top > 0, `menu ${s.top}/${s.max}`);
    check(`${w}: ...and not the page while the menu has room`, s.page === 0, `page ${s.page}`);
    for (let i = 0; i < 40 && s.top < s.max - 1; i++) { await pg.mouse.wheel(0, 200); await pg.waitForTimeout(60); s = await st(pg); }
    check(`${w}: the menu reaches its end`, s.top >= s.max - 1, `menu ${s.top}/${s.max}`);
    await pg.waitForTimeout(300); for (let i = 0; i < 4; i++) { await pg.mouse.wheel(0, 200); await pg.waitForTimeout(120); } s = await st(pg);
    check(`${w}: after the menu's end the page scrolls`, s.page > 0, `page ${s.page}`);
    await pg.mouse.move(w / 3, h / 2); await pg.mouse.wheel(0, -5000); await pg.waitForTimeout(300); s = await st(pg);
    check(`${w}: a wheel over the page still scrolls the page`, s.page === 0, `page ${s.page}`);
    await pg.close();
  }
  // phone: the drawer scrolls, the page behind stays put
  const pg = await (await b.newContext({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true })).newPage(); pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort()); await pg.addInitScript(shim);
  await pg.goto('file://' + path.resolve(__dirname, '../index.html')); await pg.waitForTimeout(900);
  await pg.click('#menuBtn'); await pg.waitForTimeout(500);
  const cs = await pg.evaluate(() => { const c = getComputedStyle(document.getElementById('nav')); return c.overflowY + ' ' + c.overscrollBehaviorY });
  check('390: the drawer scrolls and holds the page still', cs === 'auto contain', cs);
  await pg.evaluate(() => document.getElementById('nav').scrollTop = 99999); let s = await st(pg);
  check('390: the drawer scrolls to its end', s.max <= 0 || s.top > 0, `menu ${s.top}/${s.max}`);
  check('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
