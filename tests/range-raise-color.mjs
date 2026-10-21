// Action colours (range chart legend, table bubbles, seat labels, deviation view): every pair must be clearly different (CIE Lab distance).
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
  const probes = await p.evaluate(() => {
    const bg = (cls, tag = 'span', parent = document.body) => { const w = document.createElement('div'); w.className = parent; const e = document.createElement(tag); e.className = cls; document.body.appendChild(w); w.appendChild(e); const c = getComputedStyle(e); const r = { bg: c.backgroundColor, color: c.color }; w.remove(); return r; };
    const bub = k => { const w = document.createElement('div'); w.className = 'abub'; w.innerHTML = '<span class="an ' + k + '">x</span>'; document.body.appendChild(w); const r = getComputedStyle(w.firstChild).backgroundColor; w.remove(); return r; };
    const act = k => { const w = document.createElement('div'); w.className = 'seat'; w.innerHTML = '<div class="act ' + k + '">x</div>'; document.body.appendChild(w); const r = getComputedStyle(w.firstChild).color; w.remove(); return r; };
    const sw = [...document.querySelectorAll('#pf-rLegend i')].map(e => getComputedStyle(e).backgroundColor);
    return { legend: sw, bub: { fold: bub('k-fold'), call: bub('k-call'), raise: bub('k-raise'), ai: bub('k-ai') }, act: { raise: act('k-raise'), ai: act('k-ai'), fold: act('k-fold') } };
  });
  const lab = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    const f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; const X = f((.4124 * r + .3576 * g + .1805 * b) / .95047), Y = f(.2126 * r + .7152 * g + .0722 * b), Z = f((.0193 * r + .1192 * g + .9505 * b) / 1.08883); return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)]; };
  const dE = (a, c) => Math.hypot(...lab(a).map((v, i) => v - lab(c)[i]));
  const need = (name, obj, min) => { const k = Object.keys(obj); for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) { const d = dE(obj[k[i]], obj[k[j]]); if (d < min) bad.push(`${scheme}: ${name} ${k[i]}/${k[j]} too close (dE ${d.toFixed(0)}) ${obj[k[i]]} ${obj[k[j]]}`); } };
  if (probes.legend.length < 2) { bad.push(scheme + ': legend swatches not found'); await p.close(); continue; }
  need('range legend', Object.fromEntries(probes.legend.map((c, i) => ['s' + i, c])), 35);
  need('table bubbles', probes.bub, 35);
  need('seat labels', probes.act, 25);
  // the raise colour must not be the all-in colour anywhere
  if (probes.bub.raise === probes.bub.ai || probes.act.raise === probes.act.ai) bad.push(scheme + ': raise and all-in share a colour');
  await p.screenshot({ path: process.env.SHOT ? `${process.env.SHOT}-${scheme}.png` : '/dev/null' }).catch(() => {});
  await p.close();
}
await b.close();
if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); } console.log('OK');
