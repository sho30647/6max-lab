// Oracle for step 1 of the owner's theory (docs/bot-lab/policy.md 8.0, 8.3): how far is the bot's estimate of the bettor's range from the true one?
// Measurement only: the bot never sees any of this. Flop, heads-up, the first bet of the flop; all seats play <ver> in self-play.
//   true betting range  = the bettor's range before the bet (its own weights `rw`, which come from its preflop actions)
//                         x P(bets this size class | hand), found by asking the bettor's own decision function (botDecide) with hypothetical hands.
//   estimated range     = what the facing bot holds when it decides: the bettor's `rw` after narrowRange(bet) (does not look at the bet size).
//   range equity E      = the facing player's range against the bettor's betting range, a random turn and river (Monte Carlo over pairs).
//   bluff share         = the share of the betting range whose equity against the facing player's range is under 40%.
// Output: for E and the bluff share, the mean error (estimate - true), the mean absolute error and the correlation over the nodes, by bet size class.
// Usage: node tests/ring-oracle.mjs [ver=7] [hands=1000] [seed=1]
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
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const [VER, N, SEED] = [process.argv[2] || '7', +process.argv[3] || 1000, +process.argv[4] || 1];
const out = await page.evaluate(async ([VER, N, SEED]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const K = 40, M = 2, PAIRS = 300, BLUFFN = 40, BLUFFS = 10;   // candidate hands x decisions each; pairs for E; combos x samples for the bluff share
  const cls = f => f < 0.45 ? 'small' : f < 0.85 ? 'mid' : 'big';
  function sampler(w, dead) { const idx = [], cum = []; let t = 0; for (let i = 0; i < ALL.length; i++) { const x = w[i]; if (x <= 0.002) continue; const c = ALL[i]; if (dead[c.a] || dead[c.b]) continue; t += x; idx.push(i); cum.push(t); } return { idx, cum, t }; }
  function draw(L) { const x = Math.random() * L.t; let lo = 0, hi = L.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (L.cum[m] < x) lo = m + 1; else hi = m; } return ALL[L.idx[lo]]; }
  function runoutWin(h, b, board) {   // 1 = h wins, over one random turn and river
    const used = new Set([h.a, h.b, b.a, b.b, ...board]); let t, r; do { t = (Math.random() * 52) | 0; } while (used.has(t)); used.add(t); do { r = (Math.random() * 52) | 0; } while (used.has(r));
    const bd = board.concat([t, r]), x = evalHand([h.a, h.b].concat(bd)), y = evalHand([b.a, b.b].concat(bd)); return x > y ? 1 : x === y ? 0.5 : 0;
  }
  function measure(heroL, betL, board) {   // betL: sampler over the betting range; returns [E, bluff share]
    let w = 0, n = 0;
    for (let i = 0; i < PAIRS; i++) { const h = draw(heroL), b = draw(betL); if (h.a === b.a || h.a === b.b || h.b === b.a || h.b === b.b) continue; w += runoutWin(h, b, board); n++; }
    let bl = 0, bn = 0;
    for (let i = 0; i < BLUFFN; i++) { const b = draw(betL); let e = 0, m = 0; for (let j = 0; j < BLUFFS; j++) { const h = draw(heroL); if (h.a === b.a || h.a === b.b || h.b === b.a || h.b === b.b) continue; e += 1 - runoutWin(h, b, board); m++; } if (m) { bn++; if (e / m < 0.4) bl++; } }
    return [n ? w / n : NaN, bn ? bl / bn : NaN];   // E is the facing player's equity: 1 - the bettor's
  }
  const rec = [];   // {c, Et, Ee, Bt, Be}
  let oracle = null;
  const orig = window.botDecide;
  window.botDecide = function(seat) {
    const p = S.players[seat], live = S.players.filter(q => !q.folded);
    const bettorNode = S.street === 1 && live.length === 2 && S.currentBet === 0 && S.raiseCount === 0 && !oracle;
    const prior = bettorNode ? p.rw.slice() : null, pot0 = bettorNode ? potTotal() : 0;
    const toCall = S.currentBet - p.bet;
    const facingNode = S.street === 1 && toCall > 0 && oracle && oracle.hero === seat && S.raiseCount === 1;
    if (facingNode) {   // the facing player decides: measure the estimate against the truth, then play on
      const hero = p, bet = S.players[oracle.bettor], dead = new Uint8Array(52); S.board.forEach(c => dead[c] = 1);
      const heroL = sampler(hero.rw, dead), estL = sampler(bet.rw, dead);
      const trueL = { idx: oracle.idx, cum: oracle.cum, t: oracle.t };
      if (heroL.t > 0 && estL.t > 0 && trueL.t > 0) { const [Et, Bt] = measure(heroL, trueL, S.board), [Et2, Bt2] = measure(heroL, trueL, S.board), [Ee, Be] = measure(heroL, estL, S.board); rec.push({ c: oracle.c, Et, Et2, Ee, Bt, Bt2, Be }); /* Et2, Bt2: the truth measured again (the noise floor) */ }
      oracle = null;
    }
    const d = orig(seat);
    if (bettorNode && d.act === 'raise') {   // the first bet of the flop: find its true range
      const f = (d.to - p.bet) / pot0, c0 = cls(f), hero = live.find(q => q !== p), dead = new Uint8Array(52); S.board.forEach(c => dead[c] = 1); hero.hole.forEach(c => dead[c] = 1);
      const L = sampler(prior, dead), real = p.hole.slice(), idx = [], cum = []; let t = 0;
      if (L.t > 0) {
        for (let k = 0; k < K; k++) {
          const h = draw(L); p.hole = [h.a, h.b]; let hits = 0;
          for (let m = 0; m < M; m++) { const e = orig(seat); if (e.act === 'raise' && cls((e.to - p.bet) / pot0) === c0) hits++; }
          if (hits) { t += hits; idx.push(ALL.indexOf(h)); cum.push(t); }
        }
        p.hole = real;
        if (t > 0) oracle = { bettor: S.players.indexOf(p), hero: S.players.indexOf(hero), idx, cum, t, c: c0 };
      } else p.hole = real;
    }
    return d;
  };
  for (let h = 0; h < N; h++) {
    S.players.forEach(p => { p.ver = +VER; p.tw = null; });
    oracle = null; S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13);
    await playHand();
  }
  window.botDecide = orig;
  return rec;
}, [VER, N, SEED]);
await browser.close();
const stat = (rows, a, b) => { const v = rows.filter(r => isFinite(r[a]) && isFinite(r[b])), n = v.length; if (!n) return null; const d = v.map(r => r[b] - r[a]), bias = d.reduce((x, y) => x + y) / n, mae = d.reduce((x, y) => x + Math.abs(y), 0) / n, ma = v.reduce((x, r) => x + r[a], 0) / n, mb = v.reduce((x, r) => x + r[b], 0) / n; let c = 0, va = 0, vb = 0; for (const r of v) { c += (r[a] - ma) * (r[b] - mb); va += (r[a] - ma) ** 2; vb += (r[b] - mb) ** 2; } return { n, true: ma, est: mb, bias, mae, r: c / Math.sqrt(va * vb) }; };
const f2 = x => (x === null ? '-' : x.toFixed(2)).toString().padStart(6);
console.log(`ver ${VER}, ${N} hands, seed ${SEED}: flop, heads-up, the first bet; ${out.length} nodes`);
console.log('                          n   true    est    bias    MAE   corr   (noise floor rows: the truth measured twice)');
for (const c of ['all', 'small', 'mid', 'big']) {
  const rows = c === 'all' ? out : out.filter(r => r.c === c);
  for (const [name, a, b] of [['range equity E', 'Et', 'Ee'], ['bluff share', 'Bt', 'Be'], ['  noise floor E', 'Et', 'Et2'], ['  noise floor bluff', 'Bt', 'Bt2']]) { const s = stat(rows, a, b); if (s) console.log(`${(c + ' ' + name).padEnd(22)} ${String(s.n).padStart(4)} ${f2(s.true)} ${f2(s.est)} ${f2(s.bias)} ${f2(s.mae)} ${f2(s.r)}`); }
}
console.log('RESULT ' + JSON.stringify(out));
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
