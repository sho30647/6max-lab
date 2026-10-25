// The owner's example (docs/bot-lab/policy.md 8.1, 8.5): UTG opens, BB calls (a single-raised pot, heads-up), the flop is A A K, UTG bets about a third of the pot:
// in the equilibrium the BB folds about 65% (the ranges are far apart on this board). How often does the bot (all seats play <ver>) fold in this spot?
// The flop of a hand that reaches this pot is replaced by A s A h K d (skipped when a player holds one of these cards). When the BB faces UTG's bet, every one of
// <K> hands sampled from the BB's call range (its weights rw, without the cards of the board and of UTG) decides (botDecide): the share of folds is the spot's fold frequency.
// Then the BB folds, which ends the hand. Result by the bet's size: n, mean fold frequency.
// Usage: node tests/ring-aak.mjs [ver=10] [hands=20000] [seed=1] [K=80] [board=AsAhKd]   (board: three cards, rank 23456789TJQKA + suit s,c,d,h)
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
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const [VER, N, SEED, K, BD] = [process.argv[2] || '10', +process.argv[3] || 20000, +process.argv[4] || 1, +process.argv[5] || 80, process.argv[6] || 'AsAhKd'];
const out = await page.evaluate(async ([VER, N, SEED, K, BD]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const card = (r, s) => r * 4 + s, BOARD = [0, 1, 2].map(i => card('23456789TJQKA'.indexOf(BD[2 * i]), 'schd'.indexOf(BD[2 * i + 1])));
  const bucket = f => f < 0.25 ? '<25%' : f < 0.45 ? '25-45%' : f < 0.85 ? '45-85%' : '85%+';
  const res = {}; let armed = null, skipped = 0, started = 0;
  const orig = window.botDecide;
  window.botDecide = function(seat) {
    const p = S.players[seat];
    if (S.street === 1 && armed === null) {   // the first decision of the flop: is this the owner's pot?
      armed = false;
      const live = S.players.map((q, i) => i).filter(i => !S.players[i].folded);
      const fr = S.firstRaiser;
      if (live.length === 2 && S.pfRaises === 2 && fr >= 0 && posOf(fr) === 'UTG' && live.includes(fr) && live.some(i => posOf(i) === 'BB')) {
        const bb = live.find(i => posOf(i) === 'BB'), holes = S.players[fr].hole.concat(S.players[bb].hole);
        if (BOARD.some(c => holes.includes(c))) skipped++;
        else { S.board = BOARD.slice(); S.players.forEach(q => { q.rc = null; q.rc2 = null; }); armed = { utg: fr, bb }; started++; }
      }
    }
    if (armed && armed.bb === seat && S.street === 1 && S.currentBet - p.bet > 0 && S.raiseCount === 1) {   // the BB faces UTG's bet
      const toCall = S.currentBet - p.bet, pot = potTotal(), pot0 = pot - S.players.reduce((a, q) => a + q.bet, 0), f = toCall / pot0;
      const utg = S.players[armed.utg], real = p.hole.slice(), dead = new Uint8Array(52); BOARD.forEach(c => dead[c] = 1); utg.hole.forEach(c => dead[c] = 1);
      const idx = [], cum = []; let t = 0; for (let i = 0; i < ALL.length; i++) { const w = p.rw[i]; if (w <= 0.002) continue; const c = ALL[i]; if (dead[c.a] || dead[c.b]) continue; t += w; idx.push(i); cum.push(t); }
      let folds = 0, n = 0;
      if (t > 0) for (let k = 0; k < K; k++) {
        const x = Math.random() * t; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
        const c = ALL[idx[lo]]; p.hole = [c.a, c.b]; const d = orig(seat); n++; if (d.act === 'fold') folds++;
      }
      p.hole = real;
      if (n) { const b = res[bucket(f)] || (res[bucket(f)] = { n: 0, fold: 0, f: 0 }); b.n++; b.fold += folds / n; b.f += f; }
      armed = null; return { act: 'fold' };   // ends the hand
    }
    return orig(seat);
  };
  for (let h = 0; h < N; h++) {
    S.players.forEach(p => { const [v, ...tw] = String(VER).split('+'); p.ver = +v; p.tw = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === undefined ? true : +x }; })) : null; });
    armed = null; S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13);
    await playHand();
  }
  window.botDecide = orig;
  return { res, started, skipped };
}, [VER, N, SEED, K, BD]);
await browser.close();
console.log(`ver ${VER}, ${N} hands, seed ${SEED}: UTG opens, BB calls (SRP), flop ${BD}, UTG bets; ${out.started} pots set up (${out.skipped} skipped: a player held a board card)`);
for (const b of ['<25%', '25-45%', '45-85%', '85%+']) { const x = out.res[b]; if (x) console.log(`UTG's bet ${b.padEnd(7)} n=${String(x.n).padStart(3)}  mean bet ${(100 * x.f / x.n).toFixed(0)}% of the pot  BB folds ${(100 * x.fold / x.n).toFixed(0)}%   (owner's equilibrium reference: 33% bet -> about 65%)`); }
console.log('RESULT ' + JSON.stringify(out));
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
