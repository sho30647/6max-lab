// Save / resume: reload the page in the middle of a tournament (between hands, and in the middle of a hand) and continue.
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
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1200); return page;
}
// 1. play 25 hands, then "reload"
let page = await open();
const before = await page.evaluate(async () => {
  localStorage.clear(); MT.data = null; Nav.setScreen('mtt'); document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false;
  MT.start(); S.autoHero = true; let n = 0; while (!MT.over && n < 25) { await playHand(); n++; }
  const T = MT.T; return { over: MT.over, clock: Math.round(T.clock), remaining: T.remaining, stack: T.players[0].stack, hands: MT.hands.length, id: MT.id, writes: window.__writes.length, maxWrite: Math.max(...window.__writes.map(w => w[1])), names: [...new Set(window.__writes.map(w => w[0].split('/').pop().replace(/_\d+_\d+$/, '_*')))] };
});
console.log('before reload', JSON.stringify(before));
if (before.over) { console.log('hero busted too early; rerun'); process.exit(1); }
if (before.maxWrite > 900000) bad.push('a cloud write is close to the 1MB limit: ' + before.maxWrite);
await page.close();
// 2. reload: the lobby offers to continue, the state is the same
page = await open();
const after = await page.evaluate(async () => {
  Nav.setScreen('mtt'); const lobbyHasResume = !!document.getElementById('mttResume'), bank = MT.bank();
  document.getElementById('mttResume').click(); await new Promise(r => setTimeout(r, 100));
  const T = MT.T; return { lobbyHasResume, bank, clock: Math.round(T.clock), remaining: T.remaining, stack: T.players[0].stack, hands: MT.hands.length, id: MT.id, tableOk: S.players.length >= 2 && S.players[0].isHero, pend: MT.pend };
});
console.log('after reload ', JSON.stringify(after));
if (!after.lobbyHasResume) bad.push('no resume button'); if (after.bank !== 2950000) bad.push('bankroll should show the entry fee as paid: ' + after.bank);
for (const k of ['clock', 'remaining', 'stack', 'hands', 'id']) if (after[k] !== before[k]) bad.push(`${k} differs after reload: ${before[k]} -> ${after[k]}`);
if (!after.tableOk || after.pend) bad.push('table not restored');
// 3. play on, then quit in the middle of a hand
const mid = await page.evaluate(async () => {
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; S.autoHero = true;
  for (let i = 0; i < 10 && !MT.over; i++) await playHand();
  S.autoHero = false; const T = MT.T, p = playHand();   // deal a hand and leave the hero's decision pending
  await new Promise(r => setTimeout(r, 300));
  const a = JSON.parse(localStorage.getItem(MT.key() + '__act')); return { stack: T.players[0].stack, pendSaved: !!a.pend, total: T.players.filter(q => !q.out).reduce((x, q) => x + q.stack, 0), hands: MT.hands.length, remaining: T.remaining };
});
console.log('mid-hand     ', JSON.stringify(mid));
if (!mid.pendSaved) bad.push('the dealt hand was not saved as pending');
await page.close();
page = await open();
const fin = await page.evaluate(async () => {
  Nav.setScreen('mtt'); document.getElementById('mttResume').click(); await new Promise(r => setTimeout(r, 100));
  const T = MT.T; return { note: MT.note, stack: T.players[0].stack, total: T.players.filter(q => !q.out).reduce((x, q) => x + q.stack, 0), over: MT.over };
});
console.log('after quitting mid-hand', JSON.stringify(fin));
if (fin.total !== 10000000 && !fin.over) bad.push('chips not conserved after the pending hand: ' + fin.total);
if (fin.stack > mid.stack) bad.push('the hero must not gain from quitting a hand'); if (!/フォールド/.test(fin.note || '') && !fin.over) bad.push('no note about the folded hand');
await browser.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
