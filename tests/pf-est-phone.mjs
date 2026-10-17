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
  await ctx.close();
}
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
