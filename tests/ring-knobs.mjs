// The postflop knobs of BOT_TWEAKS for the exploiters of docs/bot-lab: each one changes the decision it names, left out it changes nothing,
// and the tournament ignores them. Spots on the flop, heads-up, with the bot's equity / range percentile / draw flag fixed.
//   drawEq: a draw with 35% (two cards to come) facing a pot-sized bet calls (35% + 6% implied > the 33% price); x0.6 it folds.
//   mdf:    a hand at the 55th percentile of its range with 20% equity calls a pot-sized bet by range (top half); mdf=0.5 defends half as wide: folds.
//   sizeF:  the flop bet is 1.6x as big.
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
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
const r = await page.evaluate(() => {
  const spot = (tw, { eq, q, draw, facing }) => {
    S.button = 0; S.street = 1; S.board = [0, 5, 10];
    S.players.forEach((p, i) => { p.folded = i > 1; p.bet = 0; p.contrib = i > 1 ? 0 : 200; p.stack = 9000; p.allIn = false; p.hole = [24 + 2 * i, 25 + 2 * i]; p.rw = FULL_RANGE.slice(); p.rc = null; p.ver = undefined; p.tw = tw; p.style = { loose: 1, aggr: 1, three: 1 }; });
    if (facing) { S.players[1].bet = 400; S.players[1].contrib = 600; S.currentBet = 400; S.raiseCount = 1; S.pfAggr = 1; S.prevStreetAggr = 1; }   // seat 1 bets the pot (400 into 400)
    else { S.currentBet = 0; S.raiseCount = 0; S.pfAggr = 0; S.prevStreetAggr = 0; }
    const keep = [window.equity, window.percentileOf, window.drawFlag, Math.random];
    window.equity = () => eq; window.percentileOf = () => q; window.drawFlag = () => draw; Math.random = () => 0.99;   // no dice: no raise of a draw, no trap
    try { return botPostflop(0); } finally { [window.equity, window.percentileOf, window.drawFlag, Math.random] = keep; }
  };
  const tw = x => Object.assign({}, BOT_TWEAKS[RING_VER], x);
  const D = { eq: 0.35, q: 0.2, draw: true, facing: true }, M = { eq: 0.2, q: 0.55, draw: false, facing: true }, B = { eq: 0.85, q: 0.9, draw: false, facing: false };
  const out = {
    drawBase: spot(null, D).act, drawEq: spot(tw({ drawEq: 0.6 }), D).act, drawEq1: spot(tw({ drawEq: 1 }), D).act,
    mdfBase: spot(null, M).act, mdfHalf: spot(tw({ mdf: 0.5 }), M).act, mdf1: spot(tw({ mdf: 1 }), M).act,
    sizeBase: spot(null, B).to, sizeF: spot(tw({ sizeF: 1.6 }), B).to,
  };
  MT.on = true; out.mttDrawEq = spot(tw({ drawEq: 0.6 }), D).act; MT.on = false;
  return out;
});
await browser.close();
const ok = r.drawBase === 'call' && r.drawEq === 'fold' && r.drawEq1 === 'call' && r.mdfBase === 'call' && r.mdfHalf === 'fold' && r.mdf1 === 'call'
  && r.sizeBase > 0 && r.sizeF > r.sizeBase * 1.4 && r.mttDrawEq === 'call' && !errors.length;
console.log(ok ? 'OK' : 'FAIL', JSON.stringify(r), errors.slice(0, 2).join(' | '));
process.exit(ok ? 0 : 1);
