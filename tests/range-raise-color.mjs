// Range chart: the raise colour must be clearly different from the call colour (it used to be green vs blue, hard to tell apart).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const bad = [];
const hue = c => { const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255); const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - bl) / d) % 6 : mx === g ? (bl - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: 390, height: 800 }, colorScheme: scheme });
  p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
  await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await p.goto('file://' + html);
  await p.waitForFunction(() => typeof Nav !== 'undefined' && Nav.pfGo); await p.waitForTimeout(1200);
  await p.evaluate(() => { localStorage.clear(); Nav.setScreen('pf'); Nav.pfGo('tab', 'range'); }); await p.waitForTimeout(300);
  const col = await p.evaluate(() => {
    const sw = [...document.querySelectorAll('#pf-rLegend i')].map(e => getComputedStyle(e).backgroundColor);
    return { raise: sw[0], call: sw[1], jam: getComputedStyle(document.documentElement).getPropertyValue('--jam') };
  });
  if (!col.raise || !col.call) { bad.push(scheme + ': legend swatches not found'); await p.close(); continue; }
  const hex = h => { const n = parseInt(h.trim().slice(1), 16); return `rgb(${n >> 16}, ${n >> 8 & 255}, ${n & 255})`; }; col.jam = hex(col.jam);
  const dh = (a, c) => { const d = Math.abs(hue(a) - hue(c)); return Math.min(d, 360 - d); };
  if (dh(col.raise, col.call) < 90) bad.push(`${scheme}: raise/call hue too close ${col.raise} ${col.call}`);
  if (dh(col.raise, col.jam) < 20) bad.push(`${scheme}: raise/jam hue too close ${col.raise} ${col.jam}`);
  await p.screenshot({ path: process.env.SHOT ? `${process.env.SHOT}-${scheme}.png` : '/dev/null' }).catch(() => {});
  await p.close();
}
await b.close();
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); } console.log('OK');
