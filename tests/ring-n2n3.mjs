// Replays the owner's two play impressions (docs/bot-lab/owner-notes.md N2, N3) as fixed spots and measures how often the bot folds / calls.
//   N2: 3-bet pot, board 2d 7c 2s 6h (turn), the bot holds 9h 9d (an overpair), the 3-bettor bets ~40% of the pot. The owner folded 99 and found it too much.
//   N3: single-raised pot, board Ac 2d 8d (flop), the bot (BB) holds Kd Jc (backdoor flush and straight draws only), UTG bets ~33% of the pot. The owner called and found it too tough.
// The bettor's range is a preflop-strength cut (PCT): N2 the top 8% (a 3-bet range), N3 the top 17% (a UTG open). The bot's own range: N2 the top 25% (calls a 3-bet), N3 the top 45%.
// The bot's decision is sampled <K> times (its dice differ); the share of folds / calls / raises is the result. Real equity (no stubs).
// Usage: node tests/ring-n2n3.mjs [ver=10 | ver+knob=value ...] [K=200] [seed=1]
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
await page.addInitScript(() => { window.__noPopup = true; });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const [VER, K, SEED] = [process.argv[2] || '10', +process.argv[3] || 200, +process.argv[4] || 1];
const out = await page.evaluate(([VER, K, SEED]) => {
  let a = SEED * 7919; Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  const C = (r, s) => '23456789TJQKA'.indexOf(r) * 4 + 'schd'.indexOf(s);
  const cut = pct => { const w = new Float32Array(ALL.length); for (let i = 0; i < ALL.length; i++) w[i] = PCT[ALL[i].k] < pct ? 1 : 0; return w; };
  const spot = ({ board, hole, street, pot, betFrac, bettorPct, heroPct, pfAggr3, flopBet }) => {
    S.button = 0; S.street = street; S.board = board.map(([r, s]) => C(r, s));
    S.players.forEach((p, i) => { p.folded = i > 1; p.bet = 0; p.contrib = i > 1 ? 0 : pot / 2; p.stack = 20000; p.allIn = false; p.hole = [i * 2 + 30, i * 2 + 31]; p.rw = FULL_RANGE.slice(); p.rc = null; p.rw2 = FULL_RANGE.slice(); p.rc2 = null; { const [v, ...tw] = String(VER).split('+'); p.ver = +v; p.tw = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === undefined ? true : +x }; })) : null; } p.style = { loose: 1, aggr: 1, three: 1 }; });
    const hero = S.players[0], vil = S.players[1];
    hero.hole = hole.map(([r, s]) => C(r, s));
    vil.hole = [C('2', 'h'), C('3', 'c')];
    hero.rw = cut(heroPct); vil.rw = cut(bettorPct); vil.rw2 = vil.rw.slice(); hero.rw2 = hero.rw.slice();
    if (flopBet) narrowRange(vil, 'bet', 0, { f: flopBet, hu: true, ctx: 1 });   // an earlier bet on the flop (kept in the range by the same reading)
    narrowRange(vil, 'bet', 0, street === 1 ? { f: betFrac, hu: true, ctx: 3 } : null);   // the bot's reading of the bet (a first flop bet by its size; a turn bet as it always was)
    const bet = Math.round(pot * betFrac); vil.bet = bet; vil.contrib += bet; S.currentBet = bet; S.raiseCount = 1; S.pfAggr = 1; S.prevStreetAggr = 1; S.pfRaises = pfAggr3 ? 3 : 2;
    S.pot = pot + bet;
    const res = { fold: 0, call: 0, raise: 0 };
    for (let k = 0; k < K; k++) { hero.rc = null; hero.rc2 = null; const d = botDecide(0); res[d.act === 'raise' ? 'raise' : d.act === 'call' ? 'call' : 'fold']++; }
    return res;
  };
  const n2 = spot({ board: [['2','d'],['7','c'],['2','s'],['6','h']], hole: [['9','h'],['9','d']], street: 2, pot: 2400, betFrac: 0.4, bettorPct: 8, heroPct: 25, pfAggr3: true });
  const n3 = spot({ board: [['A','c'],['2','d'],['8','d']], hole: [['K','d'],['J','c']], street: 1, pot: 600, betFrac: 0.33, bettorPct: 17, heroPct: 45, pfAggr3: false });
  const n2h = spot({ board: [['2','d'],['7','c'],['2','s'],['6','h']], hole: [['9','h'],['9','d']], street: 2, pot: 2400, betFrac: 0.4, bettorPct: 8, heroPct: 25, pfAggr3: true, flopBet: 0.5 });
  return { n2, n3, n2h };
}, [VER, K, SEED]);
await browser.close();
const f = x => `fold ${(100 * x.fold / K).toFixed(0)}%  call ${(100 * x.call / K).toFixed(0)}%  raise ${(100 * x.raise / K).toFixed(0)}%`;
console.log(`ver ${VER}, K ${K}`);
console.log(`N2 (99 overpair, 2d7c2s6h, 3-bet pot, 40% bet): ${f(out.n2)}`);
console.log(`N3 (KdJc backdoors, Ac2d8d, 33% bet):          ${f(out.n3)}`);
console.log(`N2 + the 3-bettor also bet the flop (50%):       ${f(out.n2h)}`);
if (process.argv.includes('--check')) {   // v11 and later: N3 folds a good share (v10: 0%), N2's overpair still (nearly) always calls
  const ok = out.n3.fold / K >= 0.15 && out.n2.fold / K <= 0.1 && !errors.length;
  console.log(ok ? 'OK' : 'FAIL'); process.exit(ok ? 0 : 1);
}
console.log('RESULT ' + JSON.stringify(out));
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
