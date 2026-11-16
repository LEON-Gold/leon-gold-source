const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, ignoreHTTPSErrors: true }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const fs=require('fs'); await pg.route('**/*', r => { const u = r.request().url(); if(u.includes('html2canvas')) return r.fulfill({body:fs.readFileSync('/tmp/claude-0/s/libs/html2canvas-1.4.1/dist/html2canvas.min.js'),contentType:'text/javascript'}); if(u.includes('jspdf')) return r.fulfill({body:fs.readFileSync('/tmp/claude-0/s/libs/jspdf-2.5.1/dist/jspdf.umd.min.js'),contentType:'text/javascript'}); return u.startsWith('file:') ? r.continue() : r.abort() });
  await pg.addInitScript(() => { const store = {}; const subs = {}; window.__saved = [];
    const emit = c => (subs[c] || []).forEach(f => f({ docs: Object.entries(store[c] || {}).map(([id, d]) => ({ id, data: () => d })) }));
    const db = { collection: c => ({ doc: id => ({ id, set: async d => { (store[c] = store[c] || {})[id] = d; setTimeout(() => emit(c)) } }), onSnapshot: f => { (subs[c] = subs[c] || []).push(f); setTimeout(() => emit(c)) } }) };
    window.claude = { use: async n => n === 'db' ? db : n === 'downloads' ? { save: async r => { window.__saved.push({ name: r.filename, size: r.data.size, type: r.data.type, head: await r.data.slice(0, 5).text() }); window.__last = r.data; return { status: 'saved' } } } : null }; });
  await pg.goto('file://'+require('path').resolve(__dirname,'../index.html')+''); await pg.waitForTimeout(1500);
  console.log('h2c', await pg.evaluate(() => typeof html2canvas));
  await pg.click('[data-act="new"][data-k="retail"]'); await pg.waitForTimeout(400);
  await pg.click('#pvBtn'); await pg.waitForTimeout(400);
  console.log('buttons', await pg.evaluate(() => [...document.querySelectorAll('#pvfoot button')].filter(b => !b.hidden).map(b => b.textContent)));
  await pg.click('#pvPdf'); for(let i=0;i<15;i++){await pg.waitForTimeout(1000); console.log(i, await pg.textContent('#pvmsg'), await pg.evaluate(()=>window.__saved.length));}
  console.log('msg', await pg.textContent('#pvmsg'), JSON.stringify(await pg.evaluate(() => window.__saved)));
  await pg.evaluate(() => document.querySelector('#pvSave').hidden = false); await pg.click('#pvSave'); await pg.waitForTimeout(15000);
  const b64 = await pg.evaluate(async()=>{const u=new Uint8Array(await window.__last.arrayBuffer());let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)}); require('fs').writeFileSync('/tmp/claude-0/s/inv.png', Buffer.from(b64,'base64'));
  console.log('img msg', await pg.textContent('#pvmsg'));
  console.log('errors', errs); await b.close();
})();
