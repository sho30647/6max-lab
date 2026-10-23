// Ring-game bot strength bench: two bot versions play the 6-max ring table (100bb, 0.5/1bb) against each other with duplicate deals
// (each deal is played twice: seats 0,2,4 = A and 1,3,5 = B, then swapped). Every hand starts at 100bb.
// All seats play the neutral style (loose/aggr/three = 1) so that only the logic differs.
// Usage: node tests/ring-bench.mjs <A> <B> [deals=1000] [seed=1]     versions: 3, 4, ... (the postflop logic of index.html, player.ver);
//        a version can carry changed tweaks (BOT_TWEAKS in index.html): "5+riverBluff=3" = v5 that bluffs the river 3x
//        node tests/ring-bench.mjs stats <ver> [hands=3000] [seed=1]  how a version plays: facing-bet folds and the EV of its river calls/folds
// Output (bench): A minus B in bb per 100 hands per player, with the standard error over deals. Positive = A is stronger.
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
const args = process.argv.slice(2);
const [VER, N, SEED, TW] = [args[0] || '10', +args[1] || 3000, +args[2] || 1, args[3] || ''];   // TW: extra tweaks, e.g. turnDefend=1,bluffF=2
const out = await page.evaluate(async ([VER, N, SEED, TW]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const R = { chk: {}, raise: { n: 0, big: 0, jam: 0, jamOverSmall: 0 }, cb: {}, fx: {}, bar: {} };
  const bump = (o, k, f) => { const x = o[k] || (o[k] = { n: 0, a: 0, b: 0 }); x.n++; f(x); };
  const orig = window.botDecide;
  window.botDecide = function(seat) {
    const p = S.players[seat], toCall = S.currentBet - p.bet, st = S.street;
    const d = orig(seat);
    if (st > 0) {
      const opp = S.players.filter((q, i) => i !== seat && !q.folded), hu = opp.length === 1;
      p.chk = p.chk || [0, 0, 0, 0];
      const potNow = potTotal(), potBefore = potNow - S.players.reduce((a, q) => a + q.bet, 0);
      if (toCall > 0 && d.act === 'raise' && S.raiseCount === 1) {
        const mult = (d.to - S.currentBet) / S.currentBet, jam = d.to >= p.stack + p.bet - 0.5;
        R.raise.n++; if (mult >= 8) R.raise.big++; if (jam) R.raise.jam++; if (jam && S.currentBet / potBefore < 0.5 && d.to > 5 * S.currentBet) R.raise.jamOverSmall++;
        bump(R.raise, 'st' + st + (jam ? ' jam' : ' nojam'), x => { x.a += mult; });
      }
      if (toCall === 0 && st === 1 && hu && S.pfAggr === seat) {   // c-bet by hand class
        const cat = evalHand(p.hole.concat(S.board)) >> 20, dr = drawFlag(p.hole[0], p.hole[1], S.board);
        const k = cat === 0 ? (dr ? 'highcard+draw' : 'AIR (no pair no draw)') : cat === 1 ? 'pair' : 'two pair+';
        bump(R.cb, k, x => { if (d.act === 'raise') x.a++; });
        { const qq = percentileOf(p, strengthVal(p.hole[0], p.hole[1], S.board), 'rw'); bump(R.chk, qq >= 0.8 ? 'strong (top fifth of the range)' : 'rest', x => { if (d.act !== 'raise') x.a++; }); }
        p.flopK = d.act === 'raise' ? (cat === 0 && !dr ? 'air' : 'other') : 'none';
      }
      if (toCall === 0 && st >= 2 && hu && S.prevStreetAggr === seat && p.flopK && p.flopK !== 'none') {   // barrels: the bot bet the flop and has the initiative; does it bet the next street?
        const cat = evalHand(p.hole.concat(S.board)) >> 20, dr = st === 2 && drawFlag(p.hole[0], p.hole[1], S.board), k = 'FTR'[st - 1] + ' after flop ' + p.flopK + ' bet: ' + (cat === 0 && !dr ? 'still air' : cat >= 1 ? 'made hand' : 'draw');
        bump(R.bar, k, x => { if (d.act === 'raise') x.a++; });
      }
      if (toCall === 0 && d.act === 'check') p.chk[st] = 1;
      if (toCall > 0 && st >= 2 && hu && S.raiseCount === 1) {   // facing a bet: did this bot check every earlier street?
        let allChk = true; for (let s = 1; s < st; s++) if (!p.chk[s]) allChk = false;
        const f = S.currentBet / potBefore, b = f < 0.45 ? 'S' : f < 0.85 ? 'M' : f < 1.3 ? 'L' : 'XL';
        const jamB = S.currentBet >= p.stack + p.bet;
        bump(R.fx, (allChk ? 'checked-all ' : 'other      ') + 'FTR'[st - 1] + ' ' + b, x => { if (d.act === 'fold') x.a++; });
      }
    }
    return d;
  };
  for (let h = 0; h < N; h++) { S.players.forEach(p => { p.chk = null; p.flopK = null; }); S.players.forEach((p, i) => { p.ver = +VER; p.tw = TW ? Object.assign({}, BOT_TWEAKS[VER], ...TW.split(',').map(t => { const [k, x] = t.split('='); return { [k]: x === 'true' ? true : +x }; })) : null; }); S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13); await playHand(); }
  window.botDecide = orig;
  return R;
}, [VER, N, SEED, TW]);
const pc = (a, n) => (n ? (100 * a / n).toFixed(0) : '-') + '%';
console.log(`ver ${VER}, ${N} hands, seed ${SEED}`);
const r = out.raise; console.log(`raises facing a bet: n=${r.n}, >=8x the bet: ${pc(r.big, r.n)}, all-in: ${pc(r.jam, r.n)}, all-in over a bet <50% pot and >5x: ${r.jamOverSmall}`);
for (const k of Object.keys(r).filter(k => k.startsWith('st'))) console.log('  ', k, 'n=' + r[k].n, 'avg raise = ' + (r[k].a / r[k].n).toFixed(1) + 'x the bet');
console.log('flop c-bet (HU, preflop aggressor) by hand:'); for (const k of Object.keys(out.cb)) console.log('  ', k.padEnd(24), 'n=' + out.cb[k].n, 'bet ' + pc(out.cb[k].a, out.cb[k].n));
console.log('flop check rate (HU, preflop aggressor) by strength in the range:'); for (const k of Object.keys(out.chk)) console.log('  ', k.padEnd(34), 'n=' + out.chk[k].n, 'check ' + pc(out.chk[k].a, out.chk[k].n));
console.log('barrels (HU, bot bet the flop with the initiative): bet again'); for (const k of Object.keys(out.bar).sort()) console.log('  ', k.padEnd(48), 'n=' + String(out.bar[k].n).padStart(4), 'bet ' + pc(out.bar[k].a, out.bar[k].n));
console.log('fold to a bet (HU, single raise): checked-all-streets vs other'); for (const k of Object.keys(out.fx).sort()) console.log('  ', k.padEnd(18), 'n=' + String(out.fx[k].n).padStart(5), 'fold ' + pc(out.fx[k].a, out.fx[k].n));
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }

// check: a version that c-bets almost no air makes its flop check range all air (v10: 9%). v12 and later must be above 20%.
const air = out.cb['AIR (no pair no draw)']; if (!args[3] && +VER >= 12 && air && air.a / air.n < 0.2) { console.log('FAIL: air c-bet ' + pc(air.a, air.n) + ' < 20%'); process.exit(1); }
