// Range estimation settings on a phone: the 「推定する対象」 select must stay inside the settings box (no horizontal overflow).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const bad = [];
for (const w of [360, 390, 430]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + html);
  await p.waitForFunction(() => typeof Nav !== 'undefined' && Nav.pfGo); await p.waitForTimeout(1200);
  await p.evaluate(() => { localStorage.clear(); Nav.setScreen('pf'); });
  await p.evaluate(() => Nav.pfGo('special', 'range')); await p.waitForTimeout(300);
  await p.click('#pf-setbox summary');
  const r = await p.evaluate(() => { const s = document.getElementById('pf-estKind').getBoundingClientRect(), box = document.getElementById('pf-setbox').getBoundingClientRect(); return { selR: Math.round(s.right), boxR: Math.round(box.right), scrollW: document.documentElement.scrollWidth, vw: innerWidth }; });
  console.log(w, JSON.stringify(r));
  if (r.selR > r.boxR) bad.push(`${w}: select right ${r.selR} > box right ${r.boxR}`);
  if (r.scrollW > r.vw) bad.push(`${w}: page scrolls sideways (${r.scrollW} > ${r.vw})`);
  // the answer-check screen: the long title wraps, the 乖離／正解／あなた buttons stay inside the overlay, and the page does not scroll sideways
  await p.selectOption('#pf-estKind', 'call'); await p.click('#pf-setbox summary');
  await p.click('#pf-estOpen'); await p.click('#pf-estGo'); await p.waitForTimeout(150);
  const q = await p.evaluate(() => { const o = document.querySelector('#pf-rov').getBoundingClientRect(); const bs = [...document.querySelectorAll('#pf-rov .estv button')].map(e => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }; });
    return { oL: Math.round(o.left), oR: Math.round(o.right), bs, scrollW: document.documentElement.scrollWidth, vw: innerWidth }; });
  console.log(w, 'result', JSON.stringify(q));
  if (q.scrollW > q.vw) bad.push(`${w}: result screen scrolls sideways (${q.scrollW} > ${q.vw})`);
  if (q.bs.length !== 3 || q.bs.some(e => e.r > q.oR || e.l < q.oL)) bad.push(`${w}: view buttons outside the overlay ${JSON.stringify(q)}`);
  if (q.bs.some(e => e.h > 44)) bad.push(`${w}: view buttons wrap into tall columns`);
  await ctx.close();
}
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
