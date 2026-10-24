// sizeRange: the bots read a first flop bet by its size (rw2, SIZE_FIT), the plain estimate rw does not.
//   A  a big first bet (pot-sized, heads-up) narrows rw2 far more than rw (the plain estimate keeps weak hands at 0.18-0.3x).
//   B  without the size info (any other bet) rw2 and rw narrow identically.
//   C  against that narrowed range the hero's equity read through rw2 is lower than through rw (the bettor looks stronger).
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
  const sum = a => a.reduce((x, y) => x + y, 0);
  S.board = [0, 5, 10];   // 2c 3d 4h-ish: low, rainbow
  S.players.forEach(p => { p.folded = false; p.isHero = false; });
  const fresh = p => { p.rw = FULL_RANGE.slice(); p.rw2 = FULL_RANGE.slice(); p.rc = null; p.rc2 = null; };   // (a hand start does this for every player)
  const a = S.players[1], b = S.players[2];
  S.players.forEach((p, i) => { if (i > 1) p.folded = true; });
  fresh(a); fresh(b);
  const out = { hasRw2: Array.isArray(a.rw2) || a.rw2 instanceof Float32Array };
  if (!out.hasRw2) return out;
  narrowRange(a, 'bet', 0, { f: 1.0, hu: true, ctx: 0 });
  out.A = [sum(a.rw), sum(a.rw2)];
  narrowRange(b, 'bet', 0, null);
  out.B = b.rw.every((x, i) => x === b.rw2[i]);
  S.players[0].hole = [24, 25];   // 8s 8h: an overpair
  seed(5); const e1 = equity(0, [a], 800, 'rw'); seed(5); const e2 = equity(0, [a], 800, 'rw2');
  out.C = [e1, e2];
  return out;
});
await browser.close();
const ok = r.hasRw2 && r.A[1] < 0.5 * r.A[0] && r.B === true && r.C[1] < r.C[0] - 0.03 && !errors.length;
console.log(ok ? 'OK' : 'FAIL', JSON.stringify(r), errors.slice(0, 2).join(' | '));
process.exit(ok ? 0 : 1);
