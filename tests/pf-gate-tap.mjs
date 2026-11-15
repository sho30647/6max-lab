// Preflop practice: tapping the リングゲーム card must switch screens at once, even when the cloud is slow.
// Before the fix the tap waited for a cloud read of the shared range chart (every time), with nothing on screen changing.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
// cloud reads of single docs take 4s (a slow phone connection); the user's own records load at once
const FIREBASE_STUB = `window.__slow=4000;window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:()=>new Promise(r=>setTimeout(()=>r({exists:false,data:()=>null}),window.__slow)),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));
const fails = []; const check = (ok, m) => { if (!ok) fails.push(m); };
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.goto('file://' + html);
await page.waitForFunction(() => window.PF && typeof Nav === 'object', null, { timeout: 20000 });
await page.waitForTimeout(6000);   // page-load reads are done; only the tap's own waiting is measured
const r = await page.evaluate(async () => {
  const o = {}, wait = ms => new Promise(r => setTimeout(r, ms));
  Nav.setScreen('pf-menu'); await wait(5000);   // the preflop part has finished loading
  const t0 = performance.now(); document.querySelector('[data-pfgame=cash]').click();
  while (Nav.screen !== 'pf-box' && performance.now() - t0 < 8000) await wait(20);
  o.ms1 = Math.round(performance.now() - t0); o.ctx = document.getElementById('pfCtxLbl').textContent;
  // back to the gate and in again (the second visit must be just as quick)
  Nav.setScreen('pf-menu'); await wait(100);
  const t1 = performance.now(); document.querySelector('[data-pfgame=cash]').click();
  while (Nav.screen !== 'pf-box' && performance.now() - t1 < 8000) await wait(20);
  o.ms2 = Math.round(performance.now() - t1);
  // MTT box, then the ring card again: the late cloud answer for MTT must not overwrite the ring box
  Nav.setScreen('pf-depth'); await wait(100); document.querySelector('[data-pfmtt]').click();
  while (Nav.screen !== 'pf-box' && performance.now() - t1 < 16000) await wait(20);
  o.mttMs = Math.round(performance.now() - t1 - o.ms2 - 100);
  Nav.setScreen('pf-menu'); await wait(50); document.querySelector('[data-pfgame=cash]').click(); await wait(5000);
  o.ctxAfter = window.PF.ctx().game;
  return o;
});
console.log(JSON.stringify(r));
check(r.ms1 < 500, `ring card took ${r.ms1}ms to open (cloud is slow)`);
check(r.ms2 < 500, `ring card took ${r.ms2}ms the second time`);
check(r.mttMs < 600, `MTT box took ${r.mttMs}ms to open`);
check(/リングゲーム/.test(r.ctx), `box label is "${r.ctx}"`);
check(r.ctxAfter === 'cash', `box after the late cloud answer: ${r.ctxAfter}`);
await browser.close();
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ok pf-gate-tap');
process.exit(fails.length ? 1 : 0);
