// Postflop bot at short stacks: bet sizes against the stack, bets that leave the bot "committed" without being all-in, folds after committing.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
const depths = (process.argv[2] || '15,20,30,60').split(',').map(Number), N = +process.argv[3] || 250;
const res = await page.evaluate(async ([depths, N]) => {
  localStorage.removeItem(MT.key()); MT.data = null; Nav.setScreen('mtt'); document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  const out = {}; let cur = null; const orig = botPostflopV3;
  window.botPostflopV3 = function (seat) {   // record every flop/turn/river decision of a bot
    const p = S.players[seat], pot = potTotal(), toCall = S.currentBet - p.bet, d = orig(seat);
    let eff = 0; S.players.forEach((q, i) => { if (i !== seat && !q.folded) eff = Math.max(eff, q.stack + q.bet); }); eff = Math.min(eff, p.stack + p.bet);
    cur.push({ street: S.street, toCall, pot, stack: eff, act: d.act, to: d.to, start: p.start, contrib: p.contrib, allin: d.act === 'raise' && d.to >= p.stack + p.bet });
    return d;
  };
  for (const dp of depths) {
    cur = [];
    for (let h = 0; h < N; h++) {
      MT.start(); S.autoHero = true; const T = MT.T, tb = MTT.heroTable(T);
      MTT.occ(tb).forEach(s => { T.players[tb.seats[s]].stack = Math.round(dp * 400 * (0.9 + 0.2 * Math.random())); });
      await playHand();
    }
    const bets = cur.filter(x => x.toCall === 0 && x.act === 'raise');   // opening bets
    const flopBets = bets.filter(x => x.street === 1);
    const sizeBucket = x => { const f = (x.to) / x.pot; return x.allin ? 'all-in' : f < 0.4 ? '~33%' : f < 0.6 ? '~50%' : f < 0.85 ? '~75%' : '100%+'; };
    const dist = {}; flopBets.forEach(x => { const k = sizeBucket(x); dist[k] = (dist[k] || 0) + 1; });
    // committed = not all-in, and what is left behind is at most the pot after the bet
    const committed = flopBets.filter(x => !x.allin && (x.stack - x.to) <= (x.pot + 2 * x.to));
    const facing = cur.filter(x => x.toCall > 0);
    const foldCommitted = facing.filter(x => x.act === 'fold' && x.contrib / x.start > 0.3);   // folded after putting in more than 30% of the starting stack
    const callsAll = facing.filter(x => x.act === 'call' && x.toCall >= 0.5 * x.stack);
    out[dp] = { decisions: cur.length, flopBets: flopBets.length, dist, committedBets: committed.length, facing: facing.length, foldAfter30pct: foldCommitted.length, bigCalls: callsAll.length,
      allinFlopShare: flopBets.length ? flopBets.filter(x => x.allin).length / flopBets.length : 0 };
  }
  return out;
}, [depths, N]);
for (const d of depths) { const r = res[d];
  console.log(`${d}bb: flop bets ${r.flopBets}, sizes ${JSON.stringify(r.dist)}, committed-but-not-all-in ${r.committedBets} (${r.flopBets ? Math.round(r.committedBets / r.flopBets * 100) : 0}%), folds after putting in >30% of the stack ${r.foldAfter30pct}/${r.facing} decisions facing a bet`); }
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
