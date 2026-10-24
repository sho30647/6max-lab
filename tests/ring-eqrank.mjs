// eqRank (v10): eqPercentile ranks a hand in its own range by its equity against the opponent's range (draws count).
// Board A h, 9 d, 6 h (the owner's example, docs/bot-lab/policy.md 8.2): a flush draw with a gutshot (8h 5h) must rank above a hand that is ahead now
// but has no future (J c 6 d: a pair of sixes, third pair), and the nut-like hand (A c 9 c: two pair) above both; a hand of nothing (4 s 3 c) ranks at the bottom.
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
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
const r = await page.evaluate(() => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  const card = (rank, suit) => rank * 4 + suit;   // rank 0 = 2 ... 12 = A; suit 0..3 (s c d h in this order of the engine)
  S.board = [card(12, 3), card(7, 2), card(4, 3)];   // Ah 9d 6h
  S.players.forEach((p, i) => { p.folded = i > 1; p.rw = FULL_RANGE.slice(); p.rc = null; p.rw2 = FULL_RANGE.slice(); p.rc2 = null; });
  const me = S.players[0], opp = S.players[1], out = {};
  const rank = (name, h) => { me.hole = h; seed(3); const e = equity(0, [opp], 400); seed(4); out[name] = [e, eqPercentile(0, [opp], e, 'rw', 60)]; };
  rank('flushDrawGutshot', [card(6, 3), card(3, 3)]);   // 8h 5h
  rank('thirdPairNoFuture', [card(9, 1), card(4, 2)]);   // Jc 6d: a pair of sixes
  rank('twoPair', [card(12, 1), card(7, 1)]);            // Ac 9c: aces and nines
  rank('nothing', [card(2, 0), card(1, 1)]);             // 4s 3c
  return out;
});
await browser.close();
const q = k => r[k][1];
const ok = q('twoPair') > q('flushDrawGutshot') && q('flushDrawGutshot') > q('thirdPairNoFuture') && q('thirdPairNoFuture') > q('nothing') && q('twoPair') > 0.8 && q('nothing') < 0.3 && !errors.length;
console.log(ok ? 'OK' : 'FAIL', JSON.stringify(r), errors.slice(0, 2).join(' | '));
process.exit(ok ? 0 : 1);
