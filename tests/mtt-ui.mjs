// MTT screen through the real UI code: lobby -> entry -> hands played by the engine (the hero driven by the bot logic) -> result.
import { createRequire } from 'module';
import path from 'path'; import fs from 'fs'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const html = path.resolve(here, '../index.html');
const SHOTS = process.env.SHOTS || '';   // directory for screenshots (optional)
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const bad = [];
async function run(viewport, tag) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) bad.push('console: ' + m.text().slice(0, 200)); });
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, ms > 900 ? ms : 0, ...a); });   // keep the 5 s Prefs timeout, run the rest at once
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { localStorage.removeItem(MT.key()); MT.data = null; document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; Nav.setScreen('mtt'); });
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${tag}-${name}.png`), fullPage: true }); };
  const lobbyOk = await page.evaluate(() => getComputedStyle(document.getElementById('mttLobby')).display !== 'none' && getComputedStyle(document.getElementById('tablebox')).display === 'none');
  if (!lobbyOk) bad.push(tag + ': lobby not shown');
  await shot('1-lobby');
  await page.click('#mttGo'); await page.waitForTimeout(200);
  const tableOk = await page.evaluate(() => getComputedStyle(document.getElementById('mttHud')).display !== 'none' && getComputedStyle(document.getElementById('tablebox')).display !== 'none');
  if (!tableOk) bad.push(tag + ': table not shown after entry');
  await shot('2-entered');
  const r = await page.evaluate(async () => {
    S.autoHero = true; const problems = []; let n = 0, lastLevel = 0, shots = [];
    const start = Date.now();
    while (!MT.over && n < 700 && Date.now() - start < 100000) {
      await playHand(); n++;
      const T = MT.T, alive = T.players.filter(p => !p.out), total = alive.reduce((a, p) => a + p.stack, 0);
      if (!T.done && !T.players[0].out && total !== 10000000) problems.push('hand ' + n + ': chips ' + total);
      if (S.players.length && !T.players[0].out && S.players[0].stack !== T.players[0].stack) problems.push('hand ' + n + ': hero stack differs');
      if (n === 40) shots.push('mid');
    }
    return { n, over: MT.over, problems: problems.slice(0, 5), result: MT.result, level: MTT.stats(MT.T).level, remaining: MT.T.remaining, bubbleSeen: MT.T.busts.some(b => b.place === 16) };
  });
  console.log(tag, JSON.stringify({ hands: r.n, over: r.over, level: r.level, remaining: r.remaining, place: r.result && r.result.place }));
  r.problems.forEach(p => bad.push(tag + ': ' + p)); if (!r.over) bad.push(tag + ': tournament did not end');
  await page.waitForTimeout(300);
  await shot('3-result');
  await page.evaluate(() => { document.getElementById('mttResult').classList.add('hidden'); });
  await page.evaluate(() => MT.board('clock')); await shot('4-board-clock');
  await page.evaluate(() => MT.board('rank')); await shot('5-board-rank');
  await page.evaluate(() => document.getElementById('mttBoard').classList.add('hidden'));
  await page.evaluate(() => { MT.on = false; ringRestore(); MT.view(); }); await shot('6-lobby-after');
  const an = await page.evaluate(() => ({ text: document.getElementById('mttLobby').innerText, arch: MT.arch().length, hands: MT.hands.length }));
  if (!/分析/.test(an.text)) bad.push(tag + ': no analysis card'); if (an.arch !== an.hands) bad.push(tag + ': hands not archived ' + an.arch + '/' + an.hands);
  if (an.hands >= 20 && !/スタックの深さ別/.test(an.text)) bad.push(tag + ': no depth table');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(MT.key())).results.length);
  if (saved !== 1) bad.push(tag + ': result not saved (' + saved + ')');
  // back to the ring: 6 seats, 0.5/1bb
  const ringOk = await page.evaluate(() => { Nav.setScreen('ring'); return S.players.length === 6 && BB === 100 && SB === 50 && ANTE === 0; });
  if (!ringOk) bad.push(tag + ': ring not restored');
  await page.close();
}
await run({ width: 1100, height: 900 }, 'desk');
if (process.argv.includes('--phone')) await run({ width: 390, height: 800 }, 'phone');
await browser.close();
if (bad.length) { console.log('PROBLEMS:'); [...new Set(bad)].slice(0, 12).forEach(b => console.log(' -', b)); process.exit(1); } else console.log('ok');
