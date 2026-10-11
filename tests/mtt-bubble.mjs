// The bubble: fast-forward the field to ~8 h (about 20-40 players left), then play the hero's table with the bot logic (ICM in use). Checks it runs and stays fast.
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
const r = await page.evaluate(async () => {
  const out = { tournaments: 0, hands: 0, icmCalls: 0, icmMs: 0, maxMs: 0, maxRemaining: 0, minRemaining: 999, bubbleHandsPlayed: 0, errors: [] };
  const wrap = (name) => { const f = MT[name].bind(MT); MT[name] = (...a) => { const t0 = performance.now(); const v = f(...a); const ms = performance.now() - t0; out.icmCalls++; out.icmMs += ms; out.maxMs = Math.max(out.maxMs, ms); return v; }; };
  localStorage.removeItem(MT.key()); MT.data = null; Nav.setScreen('mtt'); document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  wrap('needEq'); wrap('pressure');
  for (let t = 0; t < 3; t++) {
    MT.start(); S.autoHero = true; const T = MT.T; out.tournaments++;
    MTT.advanceTo(T, (7.6 + t * 0.3) * 3600, MTT.heroTable(T)); MTT.rebalance(T);
    for (let h = 0; h < 120 && !MT.over; h++) {
      try { await playHand(); out.hands++; } catch (e) { out.errors.push(String(e && e.message || e)); break; }
      out.maxRemaining = Math.max(out.maxRemaining, T.remaining); out.minRemaining = Math.min(out.minRemaining, T.remaining);
      if (T.remaining <= MTT.PAID + 3 && T.remaining > MTT.PAID) out.bubbleHandsPlayed++;
      if (T.remaining <= 8 && !T.done) { /* reached the final table: fine */ }
    }
    if (!MT.over) MT.forfeit();
    document.getElementById('mttResult').classList.add('hidden'); MT.on = false; ringRestore(); MT.view();
  }
  return out;
});
console.log(JSON.stringify(r));
console.log(`ICM-related calls ${r.icmCalls}, mean ${(r.icmMs / Math.max(1, r.icmCalls)).toFixed(1)} ms, max ${r.maxMs.toFixed(0)} ms`);
await browser.close();
if (r.errors.length || errors.length) { console.log('PROBLEMS', r.errors, errors.slice(0, 3)); process.exit(1); }
if (r.maxMs > 400) { console.log('PROBLEM: a decision took too long'); process.exit(1); }
console.log('ok');
