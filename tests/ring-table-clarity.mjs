// Ring table clarity: own hole cards are larger than the opponents', "whose turn" is not the same colour as the hero's own frame,
// the pot is in bb (like the stacks) outside beginner mode, tap targets are big enough, folded seats stay readable, and nothing overflows.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

for (const [vn, vp] of [['phone', { width: 390, height: 844 }], ['pc', { width: 1280, height: 900 }]]) for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.addInitScript(() => { window.__noPopup = true; });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const tag = `${vn}/${scheme}`;

  for (const beg of [false, true]) {
    const t = `${tag}${beg ? '/beginner' : ''}`;
    await page.evaluate(() => localStorage.clear()); await page.reload();
    await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && typeof MT.lobby === 'function', null, { timeout: 20000 }); await page.waitForTimeout(800);
    await page.evaluate(b => { Nav.setScreen('ring'); const c = document.getElementById('optBeginner'); c.checked = b; c.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('optFast').checked = true; document.getElementById('optAuto').checked = false; }, beg);
    // deal and wait for the hero's turn
    await page.evaluate(() => { [...document.querySelectorAll('button')].find(b => /ゲームを始める|次のハンドを配る/.test(b.textContent)).click(); });
    let turn = false;
    for (let i = 0; i < 60 && !turn; i++) { await page.waitForTimeout(300); turn = await page.evaluate(() => [...document.querySelectorAll('.controls button')].some(b => b.offsetParent && /コール|チェック/.test(b.textContent))); }
    check(turn, `${t}: never reached the hero's turn`);
    if (!turn) continue;
    const m = await page.evaluate(() => {
      const w = e => e ? e.getBoundingClientRect().width : 0, h = e => e ? e.getBoundingClientRect().height : 0;
      const hero = document.querySelector('.seat.hero .card'), opp = document.querySelector('.seat:not(.hero) .card');
      const preset = document.querySelector('.presets button'), szb = document.querySelector('.szb'), fold = document.querySelector('.controls .btn.fold');
      const opps = [...document.querySelectorAll('.seat:not(.hero)')];
      const heroPlate = document.querySelector('.seat.hero .plate');
      // simulate "an opponent is acting" and compare with the hero's own frame
      const o = opps[0]; o.classList.add('acting'); const actShadow = getComputedStyle(o.querySelector('.plate')).boxShadow; o.classList.remove('acting');
      const heroBorder = getComputedStyle(heroPlate).borderColor;
      const actColor = (actShadow.match(/rgba?\([^)]*\)/) || [''])[0];
      // simulate a folded seat
      o.classList.add('folded'); const fo = parseFloat(getComputedStyle(o).opacity); o.classList.remove('folded');
      const ctl = document.querySelector('.controls').getBoundingClientRect(), ses = document.querySelector('.session').getBoundingClientRect();
      const overflowX = document.documentElement.scrollWidth - innerWidth;
      const actOver = [...document.querySelectorAll('.seat .act')].filter(e => e.scrollWidth > e.parentElement.clientWidth + 1).length;
      return { heroW: w(hero), heroH: h(hero), oppW: w(opp), oppH: h(opp), presetH: h(preset), szbH: h(szb), foldH: h(fold), actColor, heroBorder, fo, pot: document.getElementById('pot').textContent, sesBottom: ses.bottom, ctlBottom: ctl.bottom, overflowX, actOver, vh: innerHeight };
    });
    check(m.heroW >= m.oppW * 1.25 && m.heroH >= m.oppH * 1.25, `${t}: hero cards ${m.heroW}x${m.heroH} are not clearly larger than opponents' ${m.oppW}x${m.oppH}`);
    check(m.actColor && m.actColor !== m.heroBorder, `${t}: "acting" ring (${m.actColor}) is the same colour as the hero's own frame (${m.heroBorder})`);
    check(beg ? /点$/.test(m.pot) : /bb$/.test(m.pot), `${t}: pot text "${m.pot}" has the wrong unit (beginner: 点, otherwise: bb)`);
    check(m.presetH >= 38, `${t}: preset button height ${m.presetH} < 38`);
    check(m.szbH >= 44, `${t}: +/- button height ${m.szbH} < 44`);
    check(m.foldH >= 44, `${t}: fold button height ${m.foldH} < 44`);
    check(m.fo >= 0.75, `${t}: folded seat opacity ${m.fo} < 0.75 (label unreadable)`);
    check(m.overflowX <= 0, `${t}: page overflows horizontally by ${m.overflowX}px`);
    check(m.actOver === 0, `${t}: ${m.actOver} action label(s) overflow their seat`);
    if (vn === 'phone') check(m.sesBottom <= m.vh && m.ctlBottom <= m.vh, `${t}: controls/session fall below the fold (${Math.round(m.sesBottom)} > ${m.vh})`);
  }
  check(!errors.length, `${tag}: page errors ${errors.slice(0, 2)}`);
  await ctx.close();
}
await browser.close();
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ok ring-table-clarity');
process.exit(fails.length ? 1 : 0);
