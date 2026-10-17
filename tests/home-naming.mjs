// Home / naming: "Cash" is called リングゲーム everywhere the player sees it (like on the home screen), and the home cards show the player's own numbers (ring: hands and result, MTT: bankroll).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = []; const check = (ok, m) => { if (!ok) fails.push(m); };
for (const [vn, vp] of [['phone', { width: 390, height: 844 }], ['pc', { width: 1280, height: 900 }]]) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && typeof MT.lobby === 'function' && window.PF, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async () => {
    const o = {}, vis = e => e && e.offsetParent !== null;
    localStorage.clear(); Nav.setScreen('home'); await new Promise(r => setTimeout(r, 200));
    o.statsBefore = [...document.querySelectorAll('#home .nv-card .s')].filter(vis).map(e => e.textContent.trim());
    Nav.setScreen('ring'); S.autoHero = true; document.getElementById('optAuto').checked = false; document.getElementById('optFast').checked = true;
    for (let k = 0; k < 6; k++) await playHand(); S.autoHero = false;
    Nav.setScreen('home'); await new Promise(r => setTimeout(r, 200));
    const cards = [...document.querySelectorAll('#home .nv-card')].filter(vis);
    o.ring = (cards.find(c => c.dataset.nv === 'ring').querySelector('.s') || {}).textContent;
    o.mtt = (cards.find(c => c.dataset.nv === 'mtt').querySelector('.s') || {}).textContent;
    Nav.setScreen('pf-menu'); await new Promise(r => setTimeout(r, 200));
    o.gate = [...document.querySelectorAll('#pf-gate .nv-card .t')].map(e => e.textContent.trim());
    document.querySelector('[data-pfgame=cash]').click(); await new Promise(r => setTimeout(r, 1500));
    o.title = document.getElementById('navTitle').textContent; o.ctx = (document.getElementById('pfCtxLbl') || {}).textContent;
    o.text = document.getElementById('tab-pf').innerText;
    return o;
  });
  console.log(vn, JSON.stringify(r));
  check(!r.statsBefore.some(t => /ハンド/.test(t)), `${vn}: ring stats shown before any play: ${r.statsBefore}`);
  check(/6\s*ハンド/.test(r.ring || ''), `${vn}: ring card shows no hand count ("${r.ring}")`);
  check(/¥\s*[\d,]+/.test(r.mtt || ''), `${vn}: MTT card shows no bankroll ("${r.mtt}")`);
  check(r.gate.includes('リングゲーム') && !r.gate.includes('Cash'), `${vn}: preflop gate still says ${r.gate}`);
  check(!/Cash/.test(r.title + r.ctx), `${vn}: title/label still says Cash ("${r.title}" / "${r.ctx}")`);
  check(!/Cash/.test(r.text), `${vn}: the preflop screens still show the word Cash`);
}
await browser.close();
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ok home-naming');
process.exit(fails.length ? 1 : 0);
