// MTT: the range chart after the hero's preflop action uses the MTT box nearest to the effective stack ("レンジ表なし" when the spot has none); the ring game still uses the Cash chart.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const SHOTS = process.env.SHOTS || '';
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage(); const bad = []; p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await p.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : (ms > 100 ? 25 : ms), ...a); });
await p.goto('file://' + html);
await p.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.reviewMtt && typeof MT.lobby === 'function'); await p.waitForTimeout(1500);
await p.evaluate(() => { localStorage.clear(); MT.data = null; document.getElementById('optAutoFold').checked = false; document.getElementById('optAuto').checked = false; document.getElementById('optRange').checked = true; Nav.setScreen('mtt'); });
const show = (rv) => p.evaluate(async rv => { const o = document.querySelector('.rov'); if (o) o.remove(); MT.on = true; const pr = pfReviewShow(rv); await new Promise(r => setTimeout(r, 50));
  const out = { text: (document.querySelector('.rov') || { innerText: '' }).innerText.replace(/\n/g, ' | '), grid: !!document.querySelector('.rov .grid13'), verdict: (document.querySelector('.rvj') || { innerText: '' }).innerText, game: PF.ctx().game };
  document.getElementById('rvNext').click(); await pr; return out; }, rv);
await p.evaluate(() => { MT.start(); S.autoHero = false; });
const cases = [
  ['18bb open UTG (nearest 20bb, has a chart)', { m: 'open', p: 'UTG', a: 'R', k: 'AKs', eff: 18 }, o => o.grid && /MTT 20bb/.test(o.text)],
  ['27bb open UTG (nearest 30bb, no chart)', { m: 'open', p: 'UTG', a: 'R', k: 'AKs', eff: 27 }, o => !o.grid && /レンジ表なし/.test(o.text) && /MTT 30bb/.test(o.verdict)],
  ['8bb open BTN (nearest 10bb)', { m: 'open', p: 'BTN', a: 'R', k: '72o', eff: 8 }, o => /MTT 10bb|レンジ表なし/.test(o.text + o.verdict)],
  ['90bb open CO (nearest 40bb)', { m: 'open', p: 'CO', a: 'F', k: 'T9s', eff: 90 }, o => /MTT 40bb/.test(o.text + o.verdict)],
  ['spot with no mapping at all', { none: true, act: 'call', eff: 18 }, o => /レンジ表なし/.test(o.text)],
  ['18bb vs open (BB vs UTG)', { m: 'vsOpen', p: 'BBvsUTG', a: 'C', k: '99', eff: 18 }, o => /MTT 20bb/.test(o.text + o.verdict)],
];
for (const [name, rv, ok] of cases) { const o = await show(rv); console.log(name, '->', JSON.stringify({ grid: o.grid, text: o.text.slice(0, 90), verdict: o.verdict.slice(0, 70) })); if (!ok(o)) bad.push(name + ': ' + o.text + ' / ' + o.verdict); if (o.game !== 'cash') bad.push('CTX leaked after ' + name); }
if (SHOTS) { await p.evaluate(() => { const rv = { m: 'open', p: 'UTG', a: 'R', k: 'AKs', eff: 18 }; MT.on = true; window.__q = pfReviewShow(rv); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/range-mtt-20.png' }); await p.evaluate(() => document.getElementById('rvNext').click());
  await p.evaluate(() => { window.__q = pfReviewShow({ m: 'open', p: 'UTG', a: 'R', k: 'AKs', eff: 27 }); }); await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + '/range-mtt-none.png' }); }
// the ring game still reads the Cash chart
const ring = await p.evaluate(() => { MT.on = false; const r = PFRanges.review('open', 'UTG', 'AKs', 'R'); return { has: !!r, game: PF.ctx().game }; });
if (!ring.has || ring.game !== 'cash') bad.push('ring review broken: ' + JSON.stringify(ring));
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
