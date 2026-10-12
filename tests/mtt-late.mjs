// Late registration: pick LR Lv12 in the lobby, enter, check the state at the first hand, then play on to the end.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.__writes=[];window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=(p)=>({get:async()=>({exists:false,data:()=>null}),set:async(b)=>{window.__writes.push([p,JSON.stringify(b).length]);},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext(); const bad = [];
async function open() {
  const page = await ctx.newPage(); page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1200); return page;
}
let page = await open();
const r = await page.evaluate(async () => {
  localStorage.clear(); MT.data = null; Nav.setScreen('mtt'); document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  document.querySelector('.mtlate [data-late="12"]').click(); if (document.querySelector('.mtlate [data-late="12"]').getAttribute('aria-pressed') !== 'true') throw new Error('LR button not pressed'); const bh = document.querySelector('.mtlate button').getBoundingClientRect().height; if (bh < 48) throw new Error('LR button too small: ' + bh); document.getElementById('mttGo').click();
  const T = MT.T, st = MTT.stats(T), first = { late: T.late, level: st.level, remaining: st.remaining, heroBB: +st.heroBB.toFixed(1), avgBB: +st.avgBB.toFixed(1), stack: T.players[0].stack };
  S.autoHero = true; let n = 0; while (!MT.over && n < 400) { await playHand(); n++; }
  const res = MT.load().results.slice(-1)[0];
  return { first, hands: n, over: MT.over, res: res && { place: res.place, late: res.late, level: res.level, hands: res.hands } };
});
console.log(JSON.stringify(r));
if (r.first.late !== 12 || r.first.level !== 12 || r.first.stack !== 100000) bad.push('bad late start ' + JSON.stringify(r.first));
if (r.first.remaining >= 100 || r.first.heroBB < 16 || r.first.heroBB > 17) bad.push('field/hero not as expected');
if (!r.over || !r.res || r.res.late !== 12 || r.res.place < 1 || r.res.place > 100) bad.push('result not recorded ' + JSON.stringify(r.res));
await browser.close();
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); } console.log('OK');
