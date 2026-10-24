// Bot strength bench: two bot variants play the same tournament table against each other with duplicate deals (the same cards are played
// twice with the variants swapped between the seats), at a fixed stack depth, in chips (no ICM: every hand starts from a fresh 100-player field).
// Usage: node tests/mtt-bench.mjs <A> <B> [depths=8,12,18] [deals=300] [seed=1]   (variants: base, old, tight, loose, ...)
// Output: A minus B in bb per 100 hands per player, with the standard error over deals. Positive = A is stronger.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
const [A, B] = [process.argv[2] || 'base', process.argv[3] || 'old'], depths = (process.argv[4] || '8,12,18').split(',').map(Number), DEALS = +process.argv[5] || 300, SEED = +process.argv[6] || 1;
const out = await page.evaluate(async ([A, B, depths, DEALS, SEED]) => {
  const OLD_PUSH = [[3,70,74,78,82,86,92,98],[4,55,60,65,70,76,85,95],[6,33,37,41,47,56,68,85],[8,22,25,28,33,40,52,72],[10,16,18,21,25,31,42,62],[12,12,14,16,19,24,34,50],[15,8,9,11,14,18,26,38],[20,5,6,7,9,12,18,27]];
  const mul = (t, f) => t.map(r => [r[0], ...r.slice(1).map(x => Math.min(100, x * f))]);
  const VARS = { base: null, old: { push: OLD_PUSH }, tight: { push: mul(MT_PUSH, 0.6) }, loose: { push: mul(MT_PUSH, 1.5) }, nopush: { push: mul(MT_PUSH, 0) }, allin: { push: mul(MT_PUSH, 50) }, jamtight: { jam: mul(MT_JAM, 0.5) }, jamloose: { jam: mul(MT_JAM, 2) } };
  if (!(A in VARS) || !(B in VARS)) throw new Error('unknown variant');
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  Nav.setScreen('mtt'); document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  async function play(deal, d, swap) {
    seed(SEED * 100003 + deal * 7 + d); localStorage.removeItem(MT.key()); MT.data = null; MT.start(); S.autoHero = true;   // (a bust is a result that costs the bankroll: reset it, or start() refuses after 60 busts)
    const T = MT.T, tb = MTT.heroTable(T), seats = MTT.occ(tb), pids = seats.map(s => tb.seats[s]);
    const BB0 = MTT.clockAt(T.clock).lvl.bb;
    pids.forEach((pid, i) => { const p = T.players[pid]; p.stack = Math.round(d * BB0 * (0.85 + 0.3 * Math.random())); p.tune = VARS[((i + (swap ? 1 : 0)) % 2 === 0) ? A : B]; });
    const before = pids.map(pid => T.players[pid].stack); const id0 = MT.id;
    seed(SEED * 7919 + deal * 13 + d);   // the cards and the bots' dice are the same in both plays
    if (S.running) throw new Error('S.running stuck at deal '+deal);
    if (MT.T !== T || MT.id !== id0 || MT.hands.length) throw new Error('MT.start did not start a new tournament');
    await playHand();
    window.__info = (window.__info || { plays: 0, moved: 0, ns: {} }); window.__info.plays++; window.__info.ns[pids.length] = (window.__info.ns[pids.length] || 0) + 1;
    if (S.running) throw new Error('still running after playHand');
    const r = pids.map((pid, i) => (T.players[pid].stack - before[i]) / BB0); if (r.some(x => !isFinite(x))) window.__bad = (window.__bad || []).concat([[deal, d, swap, JSON.stringify(r), pids.length, BB0, JSON.stringify(before)]]); return r;   // chips won in bb (the BB of this level)
  }
  const res = {};
  for (const d of depths) {
    const diffs = []; let skipped = 0;
    for (let k = 0; k < DEALS; k++) {
      const a = await play(k, d, false), b = await play(k, d, true);
      const n = a.length; if (n < 4) { skipped++; continue; } let sa = 0, na = 0, sb = 0, nb = 0;
      for (let i = 0; i < n; i++) { if (i % 2 === 0) { sa += a[i]; na++; sb += b[i]; nb++; } else { sb += a[i]; nb++; sa += b[i]; na++; } }   // seat i is A in play 1 when i is even, B when odd; swapped in play 2
      diffs.push((sa / na - sb / nb) * 100 / 2);   // bb/100 per player: per hand, A group against B group, averaged over the two plays
    }
    const m = diffs.reduce((x, y) => x + y, 0) / diffs.length, sd = Math.sqrt(diffs.reduce((x, y) => x + (y - m) ** 2, 0) / (diffs.length - 1));
    res[d] = { skipped, mean: m, se: sd / Math.sqrt(diffs.length), n: diffs.length };
  }
  return res;
}, [A, B, depths, DEALS, SEED]);
console.log(`A=${A} minus B=${B}, bb/100 hands per player (positive = A stronger), duplicate deals`);
for (const d of depths) { const r = out[d]; console.log(`${String(d).padStart(3)}bb  ${r.mean.toFixed(1).padStart(8)} ± ${(r.se * 1.96).toFixed(1)} (95%)  deals ${r.n}${r.skipped?' (skipped '+r.skipped+')':''}`); }
console.log('RESULT ' + JSON.stringify(out));
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
