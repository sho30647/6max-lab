// Ring bots play v6 (BOT_TWEAKS in index.html); a player with .ver===3 and the tournament keep plain v3.
// Spot: river, heads-up, facing a pot-sized bet, with 50% equity against the bettor's range as the bot reads it.
// v3 calls it (50% > the 33% the price needs); v6 folds it (v3's big river bets are mostly value: it needs 75%).
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
  const spot = ver => {
    S.button = 0; S.street = 3; S.board = [0, 5, 10, 15, 20];
    S.players.forEach((p, i) => { p.folded = i > 2; p.bet = 0; p.contrib = 1000; p.stack = 9000; p.allIn = false; p.hole = [24 + 2 * i, 25 + 2 * i]; p.rw = FULL_RANGE.slice(); p.rc = null; p.ver = 3; p.tw = null; });
    S.players[2].folded = true; S.players[1].bet = 2000; S.players[1].contrib = 3000;   // seat 1 bets the pot (2000 into 2000)
    S.currentBet = 2000; S.raiseCount = 1; S.pfAggr = 1; S.prevStreetAggr = 1;
    S.players[0].ver = ver;
    const eq = window.equity; window.equity = () => 0.5;
    try { return botPostflop(0).act; } finally { window.equity = eq; }
  };
  const ring = spot(undefined), v3 = spot(3);
  MT.on = true; const mtt = spot(undefined); MT.on = false;
  return { ring, v3, mtt, ringVer: RING_VER };
});
await browser.close();
const ok = r.ring === 'fold' && r.v3 === 'call' && r.mtt === 'call' && r.ringVer === 6 && !errors.length;
console.log(ok ? 'OK' : 'FAIL', JSON.stringify(r), errors.slice(0, 2).join(' | '));
process.exit(ok ? 0 : 1);
