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
  document.getElementById('optAutoFold').checked = false; S.autoHero = false; const T = MT.T, p = playHand();   // deal a hand and leave the hero's decision pending
  await new Promise(r => setTimeout(r, 300));
  const a = JSON.parse(localStorage.getItem(MT.key() + '__act')); localStorage.removeItem(MT.handKey());   // as on another device: no snapshot of the hand, only the pending marker
  return { stack: T.players[0].stack, pendSaved: !!a.pend, total: T.players.filter(q => !q.out).reduce((x, q) => x + q.stack, 0), hands: MT.hands.length, remaining: T.remaining };
});
console.log('mid-hand (no snapshot)', JSON.stringify(mid));
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
// 4. quit on the flop with the decision pending: the same hand (cards, board, pot) comes back and can be finished
let pg = await open();
const flop = await pg.evaluate(async () => {
  Nav.setScreen('mtt'); document.getElementById('mttResume').click(); await new Promise(r => setTimeout(r, 150));
  while (S.running) await new Promise(r => setTimeout(r, 50));   // a resumed hand may be waiting: finish it first
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; S.autoHero = false;
  for (let g = 0; g < 60; g++) {
    if (MT.over) break;
    window.__h = playHand(); const t0 = Date.now();
    while (Date.now() - t0 < 8000) { if (S.heroResolve && S.street >= 1) break; if (S.heroResolve) { const p = S.players[0]; heroChoose({ act: S.currentBet - p.bet > 0 ? 'call' : 'check' }); } if (!S.running) break; await new Promise(r => setTimeout(r, 20)); }
    if (S.heroResolve && S.street >= 1) break; await window.__h;
  }
  const T = MT.T, h = S.players[0];
  return { ok: !!S.heroResolve && S.street >= 1, hole: h.hole.join(','), board: S.board.join(','), street: S.street, pot: potTotal(), cur: S.currentBet, bet: h.bet, stack: h.stack, hands: MT.hands.length, handSaved: !!localStorage.getItem(MT.handKey()) };
});
console.log('flop pending ', JSON.stringify(flop));
if (!flop.ok) bad.push('could not reach a flop decision'); if (!flop.handSaved) bad.push('the hand in progress was not saved');
await pg.close();
pg = await open();
const back = await pg.evaluate(async () => {
  Nav.setScreen('mtt'); document.getElementById('mttResume').click();
  const t0 = Date.now(); while (!S.heroResolve && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 20));
  const h = S.players[0], same = { hole: h.hole.join(','), board: S.board.join(','), street: S.street, pot: potTotal(), cur: S.currentBet, bet: h.bet, stack: h.stack, pending: !!S.heroResolve, note: MT.note };
  heroChoose({ act: S.currentBet - h.bet > 0 ? 'fold' : 'check' });
  const t1 = Date.now(); while (S.running && Date.now() - t1 < 15000) { if (S.heroResolve) heroChoose({ act: S.currentBet - S.players[0].bet > 0 ? 'fold' : 'check' }); await new Promise(r => setTimeout(r, 20)); }
  const T = MT.T; return { same, running: S.running, hands: MT.hands.length, total: T.players.filter(q => !q.out).reduce((x, q) => x + q.stack, 0), pend: MT.pend, handSaved: !!localStorage.getItem(MT.handKey()) };
});
console.log('after reload ', JSON.stringify(back));
for (const k of ['hole', 'board', 'street', 'pot', 'cur', 'bet', 'stack']) if (back.same[k] !== flop[k]) bad.push(`${k} changed across the reload: ${flop[k]} -> ${back.same[k]}`);
if (!back.same.pending) bad.push('the decision was not pending after the reload'); if (back.running) bad.push('the hand did not finish');
if (back.hands !== flop.hands + 1) bad.push('hand count ' + flop.hands + ' -> ' + back.hands); if (back.total !== 10000000) bad.push('chips not conserved: ' + back.total);
if (back.pend || back.handSaved) bad.push('the finished hand is still marked as in progress');
await browser.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
