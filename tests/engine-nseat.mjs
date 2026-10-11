// Engine check for 2-8 seats with variable blinds and a big-blind ante: chips are conserved, hands finish, positions/blinds are right.
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
await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const res = await page.evaluate(async () => {
  const out = []; let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  for (let n = 2; n <= 8; n++) {
    const bad = []; let hands = 0, sd = 0;
    for (const lvl of [[200,400,400],[1000,2000,2000],[50,100,0]]) {
      [SB, BB, ANTE] = [lvl[0], lvl[1], lvl[2]];
      initPlayers(n); S.autoHero = true; S.button = 0; S.resetStacks = false;
      S.players.forEach((p, i) => { p.stack = i === 0 ? BB * 100000 : Math.round(BB * (3 + rnd() * 90)); });
      for (let h = 0; h < 60; h++) {
        S.players = S.players.filter((p, i) => i === 0 || p.stack > 0);   // busted bots leave, as in a tournament
        if (S.players.length < 2) break;
        if (S.button >= S.players.length) S.button = 0;
        const before = S.players.reduce((a, p) => a + p.stack, 0), nn = S.players.length;
        try { await playHand(); } catch (e) { bad.push('exception ' + e.message); break; }
        hands++; if (S.showdown) sd++;
        const after = S.players.reduce((a, p) => a + p.stack, 0);
        if (after !== before) bad.push(`n=${nn} chips ${before}->${after}`);
        if (S.players.some(p => p.stack < 0)) bad.push('negative stack');
        // blinds / positions of the hand just played
        const names = S.players.map((p, i) => posOf(i));
        if (new Set(names).size !== nn) bad.push('duplicate positions ' + names);
        const bl = blindSeats();
        if (nn === 2 && posOf(bl.sb) !== 'SB') bad.push('HU: button must be the SB');
        if (nn > 2 && (posOf(bl.sb) !== 'SB' || posOf(bl.bb) !== 'BB')) bad.push('SB/BB seats wrong');
        if (S.players.every(p => p.folded || true) && S.winners.length === 0) bad.push('no winner');
      }
    }
    out.push({ n, hands, sd, bad: [...new Set(bad)].slice(0, 5) });
  }
  // the start of a hand: blinds, big-blind ante and who acts first
  for (let n = 2; n <= 8; n++) for (const btn of [0, n - 1]) {
    [SB, BB, ANTE] = [200, 400, 400]; initPlayers(n); S.autoHero = true; S.button = btn - 1 < 0 ? n - 1 : btn - 1; S.resetStacks = false;
    S.players.forEach(p => p.stack = 100000); setupHand();
    const bl = blindSeats(), P = S.players, bad = [];
    if (potTotal() !== SB + BB + ANTE) bad.push('pot ' + potTotal());
    if (P[bl.bb].bet !== BB || P[bl.sb].bet !== SB || P[bl.bb].stack !== 100000 - BB - ANTE) bad.push('blind amounts');
    if (S.button !== btn) bad.push('button');
    if (n === 2 && (bl.sb !== btn || bl.first !== btn)) bad.push('HU order');
    if (n === 3 && bl.first !== btn) bad.push('3-handed: the button acts first');
    if (n > 3 && bl.first !== (btn + 3) % n) bad.push('UTG first');
    if (bad.length) out.push({ n, hands: 0, sd: 0, bad: ['setup btn=' + btn + ': ' + bad.join(',')] });
  }
  return out;
});
await browser.close();
let fail = errors.length > 0;
for (const r of res) { console.log(`${r.n}-handed: ${r.hands} hands, ${r.sd} showdowns`, r.bad.length ? 'PROBLEMS: ' + r.bad.join(' | ') : 'ok'); if (r.bad.length) fail = true; }
if (errors.length) console.log('page errors:', errors.slice(0, 5));
process.exit(fail ? 1 : 0);
