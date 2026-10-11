// Ring-game regression: plays N hands headlessly with a seeded RNG and compares the hand records with a saved baseline.
// usage:  node tests/ring-regression.mjs --save     (write tests/ring-baseline.json from the current code)
//         node tests/ring-regression.mjs            (compare against the baseline)
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, '../index.html');
const BASE = path.join(here, 'ring-baseline.json');
const HANDS = 300;

const FIREBASE_STUB = `
window.firebase = (function(){
  const user = { uid:'test', displayName:'Tester', email:'t@example.com', isAnonymous:false };
  const doc = () => ({ get: async()=>({exists:false,data:()=>null}), set: async()=>{}, delete: async()=>{} });
  const auth = () => ({ onAuthStateChanged: cb => { setTimeout(()=>cb(user),0); return ()=>{}; }, currentUser:user, signOut: async()=>{}, signInAnonymously: async()=>user });
  auth.GoogleAuthProvider = function(){};
  const fs = () => ({ doc, collection: () => ({ get: async()=>({docs:[]}), doc }) });
  return { initializeApp(){}, auth, firestore: fs };
})();`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' });
  if (u.startsWith('file:')) return r.continue();
  return r.abort();
});
await page.addInitScript(() => {
  window.__seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  window.__seed(12345);
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };   // the deck shuffle
  const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a);
});
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForFunction(() => window.PFRanges && PFRanges.spot, null, { timeout: 20000 });
await page.waitForTimeout(3000);
const recs = await page.evaluate(async (n) => {
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  S.autoHero = true; S.button = 0; Store.hands.length = 0; window.__seed(777);
  for (let i = 0; i < n; i++) await playHand();
  return Store.hands.map(h => { const x = { ...h }; delete x.t; return x; });
}, HANDS);
await browser.close();
const out = JSON.stringify(recs);
if (process.argv.includes('--save')) { fs.writeFileSync(BASE, out); console.log('saved', recs.length, 'hands,', out.length, 'bytes'); process.exit(0); }
const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
let diff = -1; for (let i = 0; i < Math.max(base.length, recs.length); i++) if (JSON.stringify(base[i]) !== JSON.stringify(recs[i])) { diff = i; break; }
if (diff < 0) { console.log('OK: ' + recs.length + ' hands identical to the baseline'); process.exit(0); }
console.log('DIFF at hand', diff); console.log('base:', JSON.stringify(base[diff])); console.log('now: ', JSON.stringify(recs[diff])); process.exit(1);
