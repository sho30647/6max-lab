// Bot preflop behaviour by stack depth in the tournament table: unopened-pot raise / shove frequency per position.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
const depths = (process.argv[2] || '6,10,15,20,30,60,150').split(',').map(Number), N = +process.argv[3] || 250;
const out = await page.evaluate(async ([depths, N]) => {
  localStorage.removeItem(MT.key()); MT.data = null; Nav.setScreen('mtt'); MT.start(); S.autoHero = true; document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  const res = {};
  for (const d of depths) {
    const tab = {}; let jamHands = 0, jamCallers = 0;
    for (let h = 0; h < N; h++) {
      MT.start();   // a fresh tournament every hand (the hero would otherwise bust out)
      S.autoHero = true;
      const T = MT.T; const tb = MTT.heroTable(T); MTT.occ(tb).forEach(s => { T.players[tb.seats[s]].stack = Math.round(d * 400 * (0.8 + 0.4 * Math.random())); });   // level 1: BB 400
      await playHand();
      const callers = S.log[0].filter(x => /c[0-9.]+\(AI\)/.test(x)).length, jammed = S.log[0].some(x => /r[0-9.]+\(AI\)/.test(x)); if (jammed) { jamHands++; jamCallers += callers; }
      const ent = S.log[0].map(x => x.replace('*', '')); let allFold = true;
      for (const e of ent) { const [pos, code] = e.split(' '); const o = tab[pos] || (tab[pos] = { n: 0, raise: 0, jam: 0 });
        if (allFold) { o.n++; if (code && code.startsWith('r')) { o.raise++; if (/AI/.test(e)) o.jam++; } }
        if (code !== 'f') allFold = false; }
    }
    tab._jam = { hands: jamHands, callers: jamCallers }; res[d] = tab;
  }
  return res;
}, [depths, N]);
const order = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB'];
console.log('unopened pot: raise% (shove%) by position — hands with everyone before folding');
console.log('depth'.padEnd(7) + order.map(p => p.padStart(11)).join(''));
for (const d of depths) console.log((d + 'bb').padEnd(7) + order.map(p => { const o = out[d][p]; return (o && o.n >= 10 ? `${Math.round(o.raise / o.n * 100)}% (${Math.round(o.jam / o.n * 100)})` : '-').padStart(11); }).join(''));
for (const d of depths) { const j = out[d]._jam; console.log(`${d}bb: hands with a shove ${j.hands}/${+process.argv[3] || 250}, callers per shove ${(j.callers / Math.max(1, j.hands)).toFixed(2)}`); }
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
