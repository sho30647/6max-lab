// Ring-game bot strength bench: two bot versions play the 6-max ring table (100bb, 0.5/1bb) against each other with duplicate deals
// (each deal is played twice: seats 0,2,4 = A and 1,3,5 = B, then swapped). Every hand starts at 100bb.
// All seats play the neutral style (loose/aggr/three = 1) so that only the logic differs.
// Usage: node tests/ring-bench.mjs <A> <B> [deals=1000] [seed=1]     versions: 3, 4, ... (the postflop logic of index.html, player.ver), or spec (the new bot, bot/spec);
//        a version can carry changed tweaks (BOT_TWEAKS in index.html): "5+riverBluff=3" = v5 that bluffs the river 3x
//        node tests/ring-bench.mjs stats <ver> [hands=3000] [seed=1]  how a version plays: facing-bet folds and the EV of its river calls/folds
// Output (bench): A minus B in bb per 100 hands per player, with the standard error over deals. Positive = A is stronger.
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
const args = process.argv.slice(2);
const mode = args[0] === 'stats' ? 'stats' : 'bench';
const [A, B, N, SEED] = mode === 'stats' ? [args[1] || '3', null, +args[2] || 3000, +args[3] || 1] : [args[0] || '4', args[1] || '3', +args[2] || 1000, +args[3] || 1];
const out = await page.evaluate(async ([mode, A, B, N, SEED]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  async function play(deal, vers, button) {
    S.players.forEach((p, i) => { const [v, ...tw] = String(vers[i]).split('+'); p.ver = v === 'spec' ? 'spec' : +v; p.tw = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === undefined ? true : +x }; })) : null; });   // "6+riverBluff=3": v6 with a tweak changed
    S.resetStacks = true; S.button = button; Store.hands.length = 0;
    seed(SEED * 7919 + deal * 13);   // the cards and the bots' dice are the same in both plays
    await playHand();
    return S.players.map(p => (p.stack - p.start) / BB);
  }
  if (mode === 'stats') {
    // facing a bet after the flop: fold / call / raise by street and size; on the river (heads-up) the chip EV of calling, known exactly from the cards
    const st = {}, add = (k, f) => { const x = st[k] || (st[k] = { n: 0, fold: 0, call: 0, raise: 0, evCallOfFolds: 0, evCallOfCalls: 0 }); f(x); x.n++; };
    const orig = window.botDecide;
    window.botDecide = function(seat) {
      const p = S.players[seat], toCall = S.currentBet - p.bet;
      const lateHU = S.street >= 2 && toCall > 0 && S.raiseCount === 1 && S.players.filter(q => !q.folded).length === 2;
      const eq = lateHU ? equity(seat, S.players.filter((q, i) => i !== seat && !q.folded), 400) : 0;   // what the bot believes: its equity against the range it reads
      const d = orig(seat);
      if (S.street > 0 && toCall > 0 && S.raiseCount === 1) {
        const pot = potTotal(), f = S.currentBet / (pot - S.players.reduce((a, q) => a + q.bet, 0)), b = f < 0.45 ? 'S(<45%)' : f < 0.85 ? 'M(45-85%)' : f < 1.3 ? 'L(85-130%)' : 'XL(130%+)';
        const opp = S.players.filter((q, i) => i !== seat && !q.folded), hu = opp.length === 1;
        let ev = null;
        if (lateHU && S.street === 3) { const me = evalHand(p.hole.concat(S.board)), o = evalHand(opp[0].hole.concat(S.board)); const w = me > o ? 1 : me === o ? 0.5 : 0; ev = (w * (pot + toCall) - toCall) / BB;
          const ek = 'eq ' + 'FTR'[S.street - 1] + ' ' + b.split('(')[0] + ' ' + (Math.min(9, Math.floor(eq * 10)) / 10).toFixed(1); const y = st[ek] || (st[ek] = { n: 0, calls: 0, ev: 0 }); y.n++; y.ev += ev; if (d.act === 'call') y.calls++; }   // against folding: pay toCall, win everything in the pot
        if (S.street === 2 && hu) {   // turn: the call's EV if no more chips go in (every river card against the bettor's actual hand)
          const used = new Set(S.players.flatMap(q => q.hole).concat(S.board)); let w = 0, c = 0;
          for (let r = 0; r < 52; r++) { if (used.has(r)) continue; const bd = S.board.concat([r]), me = evalHand(p.hole.concat(bd)), o = evalHand(opp[0].hole.concat(bd)); w += me > o ? 1 : me === o ? 0.5 : 0; c++; }
          w /= c; ev = (w * (pot + toCall) - toCall) / BB;
          const ek = 'eq T ' + b.split('(')[0] + ' ' + (Math.min(9, Math.floor(eq * 10)) / 10).toFixed(1); const y = st[ek] || (st[ek] = { n: 0, calls: 0, ev: 0 }); y.n++; y.ev += ev; if (d.act === 'call') y.calls++;
        }
        const k = ['', 'F', 'T', 'R'][S.street] + ' ' + b + (hu ? '' : ' multi');
        add(k, x => { const a = d.act === 'raise' ? 'raise' : d.act === 'call' ? 'call' : 'fold'; x[a]++; if (ev !== null) { if (a === 'fold') x.evCallOfFolds += ev; if (a === 'call') x.evCallOfCalls += ev; } });
      }
      return d;
    };
    for (let h = 0; h < N; h++) await play(h, Array(6).fill(A), h % 6);
    window.botDecide = orig;
    return st;
  }
  const diffs = [];
  for (let k = 0; k < N; k++) {
    const btn = k % 6;
    const a = await play(k, [A, B, A, B, A, B], btn), b = await play(k, [B, A, B, A, B, A], btn);
    let sa = 0, sb = 0;
    for (let i = 0; i < 6; i++) { if (i % 2 === 0) { sa += a[i]; sb += b[i]; } else { sb += a[i]; sa += b[i]; } }
    diffs.push((sa / 3 - sb / 3) * 100 / 2);   // bb/100 per player: per hand, A group against B group, averaged over the two plays
  }
  const m = diffs.reduce((x, y) => x + y, 0) / diffs.length, sd = Math.sqrt(diffs.reduce((x, y) => x + (y - m) ** 2, 0) / (diffs.length - 1));
  return { mean: m, se: sd / Math.sqrt(diffs.length), n: diffs.length };
}, [mode, A, B, N, SEED]);
if (mode === 'stats') {
  console.log(`ver ${A}, ${N} hands: facing a single bet after the flop (river EV = chip EV of calling, in bb, from the actual cards)`);
  for (const k of Object.keys(out).sort()) { const x = out[k]; if (k.startsWith('eq ')) { console.log(`river HU ${k.slice(3).padEnd(8)} n=${String(x.n).padStart(5)}  calls ${(100 * x.calls / x.n).toFixed(0).padStart(3)}%  EV(call) ${(x.ev / x.n).toFixed(2)}bb`); continue; } }
  for (const k of Object.keys(out).sort()) { if (k.startsWith('eq ')) continue; const x = out[k]; console.log(`${k.padEnd(18)} n=${String(x.n).padStart(5)}  fold ${(100 * x.fold / x.n).toFixed(0).padStart(3)}%  call ${(100 * x.call / x.n).toFixed(0).padStart(3)}%  raise ${(100 * x.raise / x.n).toFixed(0).padStart(3)}%` + ((k.startsWith('R') || k.startsWith('T')) && !k.includes('multi') ? `  EV(call) of folds ${(x.fold ? x.evCallOfFolds / x.fold : 0).toFixed(2)}bb  of calls ${(x.call ? x.evCallOfCalls / x.call : 0).toFixed(2)}bb` : '')); }
  console.log('RESULT ' + JSON.stringify(out));
} else {
  console.log(`A=v${A} minus B=v${B}: bb/100 hands per player (positive = A stronger), ${out.n} duplicate deals, seed ${SEED}`);
  console.log(`${out.mean.toFixed(1)} ± ${(1.96 * out.se).toFixed(1)} (95%)`);
  console.log('RESULT ' + JSON.stringify(out));
}
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
