// Phone layout (390px wide): on the 7-8 seat tournament table no seat plate may cover the board cards at the end of a hand.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  let a = 5; Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
  crypto.getRandomValues = x => { for (let i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 4294967296); return x; };
  const res = []; let hands = 0;
  for (const want of [8, 7, 6, 5, 4, 3, 2]) {   // a fresh tournament per table size; the hero's table is thinned out to that size (layout test only)
    localStorage.clear(); MT.data = null; Nav.setScreen('mtt'); MT.start(); S.autoHero = true; document.getElementById('optAuto').checked = false;
    for (let k = 0; k < 40 && !MT.over; k++) { MT.T.players[0].stack = 400000;
      const tb = MTT.heroTable(MT.T); let n = MTT.occ(tb).length;
      for (const s of MTT.occ(tb)) { if (n <= want) break; const pid = tb.seats[s]; if (pid === 0) continue; tb.seats[s] = null; MT.T.players[pid].tableId = -1; n--; }
      await playHand(); hands++; const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    const cards = [...document.querySelectorAll('#board .card')].map(r); if (cards.length < 5) continue;
    const bx = [Math.min(...cards.map(c => c[0])), Math.min(...cards.map(c => c[1])), Math.max(...cards.map(c => c[2])), Math.max(...cards.map(c => c[3]))];
    const seats = [...document.querySelectorAll('.seat')].map(r);
    const ov = seats.map((s, i) => (s[2] > bx[0] && s[0] < bx[2] && s[3] > bx[1] && s[1] < bx[3]) ? i : -1).filter(i => i >= 0);
    res.push({ n: document.querySelectorAll('.seat').length, ov, k, bx, seats: seats.map(q => q.map(Math.round)) }); } }
  return { hands, res }; });
await page.screenshot({ path: '/tmp/claude-0/-home-user-6max-lab/4ad6068b-d72e-5923-b02a-dcea916e0b30/scratchpad/shots/ov.png' });
const by={}; out.res.forEach(o=>{const k=o.n; by[k]=by[k]||[0,0]; by[k][0]++; if(o.ov.length) by[k][1]++;}); console.log('by seats [hands, overlapping]', JSON.stringify(by));
const bad = out.res.filter(o => o.ov.length).length; console.log(bad ? 'FAIL' : 'ok', 'hands', out.hands, out.hands, 'with a board', out.res.length, 'overlap of a seat over the board cards:', out.res.filter(o => o.ov.length).length, JSON.stringify(out.res.filter(o => o.ov.length).slice(0, 4)));
await browser.close();
process.exit(bad || !out.res.length ? 1 : 0);
