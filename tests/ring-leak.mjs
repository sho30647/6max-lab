// Where does a version lose to an exploiter? Seats 0,2,4 play <VER>, seats 1,3,5 play <OPP> (a version with tweaks, e.g. "11+bluffT=3"), same cards both ways round.
// For the <VER> seats facing a single bet heads-up on the turn / river: fold rate by bet size, and the chip EV of calling (from the real cards; turn: no more chips after the river card)
// separately for the hands it folded and the hands it called. EV(call | fold) > 0 = it folds hands that should have called (over-fold).
// Usage: node tests/ring-leak.mjs <VER> <OPP> [hands=3000] [seed=1]
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
const [VER, OPP, N, SEED] = [args[0] || '11', args[1] || '11+bluffT=3', +args[2] || 3000, +args[3] || 1];
const out = await page.evaluate(async ([VER, OPP, N, SEED]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const setVer = (p, spec) => { const [v, ...tw] = String(spec).split('+'); p.ver = +v; p.tw = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === 'true' ? true : +x }; })) : null; };
  const st = {};
  const orig = window.botDecide;
  window.botDecide = function(seat) {
    const d = orig(seat), p = S.players[seat], toCall = S.currentBet - p.bet;
    if (seat % 2 === 0 && S.street >= 2 && toCall > 0 && S.raiseCount === 1) {
      const opp = S.players.filter((q, i) => i !== seat && !q.folded);
      if (opp.length === 1) {
        const pot = potTotal(), potB = pot - S.players.reduce((a, q) => a + q.bet, 0), f = S.currentBet / potB, b = f < 0.45 ? 'S' : f < 0.85 ? 'M' : f < 1.3 ? 'L' : 'XL';
        let w = 0;
        if (S.street === 3) { const me = evalHand(p.hole.concat(S.board)), o = evalHand(opp[0].hole.concat(S.board)); w = me > o ? 1 : me === o ? 0.5 : 0; }
        else { const used = new Set(S.players.flatMap(q => q.hole).concat(S.board)); let c = 0; for (let r = 0; r < 52; r++) { if (used.has(r)) continue; const bd = S.board.concat([r]), me = evalHand(p.hole.concat(bd)), o = evalHand(opp[0].hole.concat(bd)); w += me > o ? 1 : me === o ? 0.5 : 0; c++; } w /= c; }
        const ev = (w * (pot + toCall) - toCall) / BB, k = (S.street === 2 ? 'T ' : 'R ') + b, x = st[k] || (st[k] = { n: 0, fold: 0, evF: 0, evC: 0, call: 0 });
        x.n++; if (d.act === 'fold') { x.fold++; x.evF += ev; } else if (d.act === 'call') { x.call++; x.evC += ev; }
      }
    }
    return d;
  };
  for (let h = 0; h < N; h++) { S.players.forEach((p, i) => setVer(p, i % 2 === 0 ? VER : OPP)); S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13); await playHand(); }
  window.botDecide = orig;
  return st;
}, [VER, OPP, N, SEED]);
console.log(`${VER} facing a single bet from ${OPP} (heads-up), ${N} hands, seed ${SEED}. EV in bb of calling, from the real cards`);
for (const k of Object.keys(out).sort()) { const x = out[k]; console.log(k.padEnd(6), 'n=' + String(x.n).padStart(4), 'fold ' + (100 * x.fold / x.n).toFixed(0).padStart(3) + '%', ' EV(call | it folded) ' + (x.fold ? (x.evF / x.fold).toFixed(2) : '-').padStart(6), ' EV(call | it called) ' + (x.call ? (x.evC / x.call).toFixed(2) : '-').padStart(6), ' lost by folding ' + (x.evF).toFixed(0) + 'bb total'); }
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
