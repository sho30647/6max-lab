// Sound effects: the table plays a sound for the deal, each action, the board cards, the hero's turn and the result; the preflop trainer plays one for its verdict; 設定 → 効果音 off makes no sound.
// Sfx.log records the names of the sounds played (the audio itself is not checked).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));
const fails = []; const check = (ok, m) => { if (!ok) fails.push(m); };
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => fails.push('page error: ' + e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && window.PF, null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.mouse.click(5, 5);   // a first tap unlocks the audio
const r = await page.evaluate(async () => {
  const o = {}, wait = ms => new Promise(r => setTimeout(r, ms));
  o.has = typeof window.Sfx === 'object';
  if (!o.has) return o;
  o.settingDefault = document.getElementById('optSound').checked;
  Nav.setScreen('ring');
  ['optAuto', 'optAutoFold', 'optBeginner'].forEach(id => document.getElementById(id).checked = false);
  document.getElementById('optFast').checked = true;
  // the hero's turn: the chime
  Sfx.log.length = 0; const p = playHand();
  for (let i = 0; i < 100 && !S.heroResolve; i++) await wait(50);
  o.turn = Sfx.log.slice();
  heroChoose({ act: S.currentBet > S.players[0].bet ? 'fold' : 'check' }); await p;
  // hands played out: deal / actions / board / result
  S.autoHero = true; const seen = new Set();
  for (let k = 0; k < 150 && !(['win', 'lose', 'split'].some(n => seen.has(n)) && ['board', 'check'].every(n => seen.has(n)) && k >= 12); k++) { Sfx.log.length = 0; await playHand(); Sfx.log.forEach(n => seen.add(n)); }   // until the hero has stayed to the end of a hand
  o.seen = [...seen];
  // off: nothing
  const box = document.getElementById('optSound'); box.checked = false; box.dispatchEvent(new Event('change'));
  o.stored = localStorage.getItem('sixmaxlab_sound');
  Sfx.log.length = 0; for (let k = 0; k < 3; k++) await playHand(); o.offLog = Sfx.log.slice();
  box.checked = true; box.dispatchEvent(new Event('change')); S.autoHero = false;
  // preflop trainer verdict
  Nav.setScreen('pf-menu'); await wait(200);
  document.querySelector('[data-pfgame=cash]').click(); await wait(1500);
  const mode = document.querySelector('[data-pfmode=open], [data-mode=open]'); if (mode) { mode.click(); await wait(800); }
  Sfx.log.length = 0;
  const btn = [...document.querySelectorAll('#pf-controls [data-a]')].find(b => b.dataset.a === 'F' && !b.disabled);
  o.pfBtn = !!btn; if (btn) { btn.click(); await wait(300); }
  o.pfLog = Sfx.log.slice();
  return o;
});
console.log(JSON.stringify(r));
check(r.has, 'no Sfx module');
if (r.has) {
  check(r.settingDefault, 'the 効果音 setting is off by default');
  check(r.turn.includes('deal') && r.turn.includes('turn'), `no deal / turn sound before the hero acts: ${r.turn}`);
  for (const n of ['deal', 'fold', 'board']) check(r.seen.includes(n), `never played "${n}" in up to 150 hands: ${r.seen}`);
  check(r.seen.some(n => ['call', 'bet', 'raise', 'allin'].includes(n)), `no chip sound in up to 150 hands: ${r.seen}`);
  check(r.seen.some(n => ['win', 'lose', 'split'].includes(n)), `no result sound in up to 150 hands: ${r.seen}`);
  check(r.stored === '0' && r.offLog.length === 0, `sound off still played: ${r.offLog} (stored ${r.stored})`);
  check(!r.pfBtn || r.pfLog.some(n => ['ok', 'mix', 'ng'].includes(n)), `the preflop trainer played no verdict sound: ${r.pfLog}`);
  check(r.pfBtn, 'the preflop trainer fold button was not found');
}
await browser.close();
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
