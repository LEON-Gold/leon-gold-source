const { chromium } = require('playwright');
const path = process.argv[2];
let CTX;
async function mk(b, o) {
  CTX = CTX || await b.newContext({ viewport: { width: 390, height: 780 } });
  const pg = await CTX.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
  await pg.addInitScript((o) => {
    const store = JSON.parse(localStorage.getItem('__st') || '{}'); const subs = {}; let n = 0;
    const save = () => localStorage.setItem('__st', JSON.stringify(store));
    const emit = c => (subs[c] || []).forEach(f => f({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, data: () => JSON.parse(JSON.stringify(d)) })) }));
    const db = { collection: c => ({ doc: id => { id = id || ('id' + Date.now() + (++n)); return { id,
      set: async d => { (store[c] = store[c] || {})[id] = JSON.parse(JSON.stringify(d)); save(); setTimeout(() => emit(c)); },
      update: async d => { Object.assign(store[c][id], d); save(); setTimeout(() => emit(c)); },
      delete: async () => { delete store[c][id]; save(); setTimeout(() => emit(c)); } }; },
      onSnapshot: (f) => { (subs[c] = subs[c] || []).push(f); setTimeout(() => emit(c)); } }) };
    window.__store = store;
    const user = { me: async () => ({ id: 'u1', name: o.name, avatarUrl: '', isOwner: o.owner }), can: async () => true };
    window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : null };
  }, o);
  await pg.goto('file://' + path); await pg.waitForTimeout(500); return { pg, errs };
}
const sec = pg => pg.evaluate(() => [...document.querySelectorAll('.sec')].pop().innerText.replace(/\n+/g, ' | '));
(async () => {
  const b = await chromium.launch();
  // legacy single-PIN doc migrates as «مدیر»
  let { pg, errs } = await mk(b, { owner: true, name: 'علی' });
  await pg.evaluate(async () => { const db = await window.claude.use('db'); await db.collection('settings').doc('lock').set({ hash: 'x', salt: 'y' }) });
  await pg.waitForTimeout(200);
  console.log('legacy gate?', !!(await pg.$('#gate')), await pg.evaluate(() => document.querySelector('#gate input#gateUser') && 'has user field'));
  await pg.evaluate(async () => { const db = await window.claude.use('db'); await db.collection('settings').doc('lock').delete() });
  await pg.waitForTimeout(200);
  console.log('sec0:', await sec(pg));
  await pg.click('[data-act="pinset"]'); await pg.fill('#pnU', 'علی'); await pg.fill('#pn1', '1234'); await pg.fill('#pn2', '۱۲۳۴'); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="pinset"]:not([data-u])'); await pg.fill('#pnU', 'Sara'); await pg.fill('#pn1', '5555'); await pg.fill('#pn2', '5555'); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="pinset"]:not([data-u])'); await pg.fill('#pnU', 'sara'); await pg.fill('#pn1', '5555'); await pg.fill('#pn2', '5555'); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(100);
  console.log('dup:', await pg.textContent('#pnErr')); await pg.click('.modal [data-n]');
  console.log('sec1:', await sec(pg), '| lockBtn:', await pg.textContent('#lockBtn'), '| gate?', !!(await pg.$('#gate')));
  await pg.click('#nav [data-tab="parties"]'); await pg.waitForTimeout(100);
  await pg.click('#lockBtn'); await pg.waitForTimeout(200);
  console.log('remembered user:', await pg.inputValue('#gateUser'));
  await pg.fill('#gateUser', ' SARA '); await pg.fill('#gatePin', '1234'); await pg.waitForTimeout(1800);
  console.log('wrong pw:', await pg.textContent('#gateErr'));
  await pg.fill('#gateUser', ''); await pg.$eval('#gateForm', f => f.requestSubmit()); await pg.waitForTimeout(100); console.log('empty user:', await pg.textContent('#gateErr'));
  await pg.fill('#gateUser', ' SARA '); await pg.locator('#gateUser').press('Enter'); await pg.keyboard.type('5555'); await pg.screenshot({ path: '/tmp/claude-0/s/gate3.png' }); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  console.log('sara in gate?', !!(await pg.$('#gate')), '| lockBtn:', await pg.textContent('#lockBtn'));
  await pg.click('#nav [data-tab="home"]'); await pg.waitForTimeout(100);
  await pg.evaluate(async () => { document.querySelector('[data-act="newparty"]') });
  console.log('sec2:', await sec(pg));
  await pg.click('[data-act="pinoff"][data-u="علی"]'); await pg.click('.modal [data-y]'); await pg.waitForTimeout(300);
  await pg.click('[data-act="pinset"]:not([data-u])'); await pg.fill('#pnU', 'رضا'); await pg.fill('#pn1', '7777'); await pg.fill('#pn2', '7777'); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(300);
  console.log('m:', await pg.evaluate(()=>[...document.querySelectorAll('.modal')].map(m=>m.innerText.replace(/\n/g,' '))));
  await pg.click('[data-act="urename"][data-u="Sara"]'); await pg.fill('#rnU','  رضا '); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(100); console.log('rename dup:', await pg.textContent('#rnErr'));
  await pg.fill('#rnU','سارا'); await pg.click('.modal [type=submit]'); await pg.waitForTimeout(300);
  console.log('renamed:', await pg.textContent('#lockBtn'), await pg.evaluate(()=>localStorage.getItem('leon_user')));
  await pg.reload(); await pg.waitForTimeout(500); console.log('still unlocked after reload?', !(await pg.$('#gate')));
  await pg.click('#lockBtn'); await pg.waitForTimeout(200); await pg.keyboard.type('5555'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); console.log('login as سارا with old pw:', !(await pg.$('#gate')), await pg.textContent('#lockBtn'));
  console.log('after del:', JSON.stringify(await pg.evaluate(() => window.__store.settings.lock.users.map(u => u.u))));
  await pg.screenshot({ path: '/tmp/claude-0/s/sec2.png', fullPage: true });
  console.log('errors:', errs);
  await b.close();
})();
