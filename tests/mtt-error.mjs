// A bot that throws in the middle of a hand must not freeze the table: the error is shown, the tournament hand is folded (chips conserved), the ring hand just ends, and the next hand can be dealt.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage(); const bad = [];
p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await p.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
await p.goto('file://' + html);
await p.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function'); await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const out = {}; const origErr = console.error; console.error = () => {};
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  const orig = botPreflop; let boom = 1; window.botPreflop = s => { if (boom-- > 0) throw new Error('test explosion'); return orig(s); };
  // ring
  S.autoHero = true; await playHand();
  out.ring = { running: S.running, msg: document.getElementById('msg').innerText, button: !!document.getElementById('btnDeal') };
  boom = 0; await playHand(); out.ringNext = { running: S.running, ok: S.log[0].length > 0 };
  // tournament
  localStorage.clear(); MT.data = null; Nav.setScreen('mtt'); MT.start(); S.autoHero = true; boom = 1;
  await playHand();
  const T = MT.T; out.mtt = { running: S.running, pend: !!MT.pend, msg: document.getElementById('msg').innerText, total: T.players.filter(q => !q.out).reduce((a, q) => a + q.stack, 0), hands: MT.hands.length };
  boom = 0; await playHand(); out.mttNext = { running: S.running, hands: MT.hands.length };
  console.error = origErr; return out;
});
console.log(JSON.stringify(r));
if (r.ring.running || !/エラー/.test(r.ring.msg) || !r.ring.button) bad.push('ring did not recover');
if (!r.ringNext.ok || r.ringNext.running) bad.push('ring next hand failed');
if (r.mtt.running || r.mtt.pend || !/エラー/.test(r.mtt.msg)) bad.push('tournament did not recover'); if (r.mtt.total !== 10000000) bad.push('chips not conserved: ' + r.mtt.total);
if (r.mttNext.running || r.mttNext.hands !== 1) bad.push('tournament next hand failed: ' + JSON.stringify(r.mttNext));
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
