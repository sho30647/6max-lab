// Range estimation special, 'call' kinds (the villain CALLED the hero's action): the table shows that state first, a button starts the range building,
// and the hero's own range chart can be opened to check whether the action was right.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const EXPECT4 = 4.82;   // BTN's call range vs a CO 4bet, % of all combos
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 900, height: 1000 } }); const bad = []; p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await p.goto('file://' + html);
await p.waitForFunction(() => typeof Nav !== 'undefined' && Nav.pfGo); await p.waitForTimeout(1500);
await p.evaluate(() => { localStorage.clear(); Nav.setScreen('pf'); });
await p.evaluate(() => Nav.pfGo('special', 'range')); await p.waitForTimeout(300);
const vis = s => p.$eval(s, e => !!(e.offsetParent)).catch(() => false);
const KINDS = [
  ['call', '3ベット', /あなたの3ベット（[\d.]+bb）に (UTG|HJ|CO|BTN|SB) がコールするレンジ/],
  ['callo', 'オープン', /あなたの(UTG|HJ|CO|BTN|SB) のオープン（[\d.]+bb）に (HJ|CO|BTN|SB|BB) がコールするレンジ/],
  ['call4', '4ベット', /あなたのCOの4ベット（[\d.]+bb）に BTN がコールするレンジ/]];
for (const [kind, act, re] of KINDS) {
  await p.click('#pf-setbox summary'); await p.selectOption('#pf-estKind', kind); await p.click('#pf-setbox summary');
  for (let i = 0; i < 6; i++) {
    const tag = kind + '#' + i;
    // 1) the state is drawn first: hero raised, one seat called, everyone else folded; no fold/call/raise answer buttons
    const st = await p.$$eval('#pf-tablebox .seat', es => es.map(e => ({ hero: e.classList.contains('hero'), folded: e.classList.contains('folded'), backs: e.querySelectorAll('.card.back').length, act: e.querySelector('.act').textContent.trim() })));
    const hero = st.find(s => s.hero), callers = st.filter(s => /^コール/.test(s.act));
    if (!hero || !hero.act.includes(act)) bad.push(tag + ' hero act: ' + JSON.stringify(hero));
    if (callers.length !== 1) bad.push(tag + ' callers: ' + JSON.stringify(st));
    if (st.filter(s => !s.hero && !/^コール/.test(s.act) && !s.folded).length) bad.push(tag + ' unfolded extra seats: ' + JSON.stringify(st));
    if (st.some(s => s.folded && s.backs)) bad.push(tag + ' folded seat still shows cards');
    if (callers.length === 1 && callers[0].backs !== 2) bad.push(tag + ' caller should show two face-down cards');
    if (await vis('#pf-actRow')) bad.push(tag + ' answer buttons visible');
    if (await vis('#pf-rov')) bad.push(tag + ' overlay open before the button');
    // 2) the hero's own range chart
    await p.click('#pf-estChart'); await p.waitForTimeout(80);
    const chart = await p.$eval('#pf-rov', e => ({ cls: e.className, cells: e.querySelectorAll('.grid13 button').length, cur: !!e.querySelector('.cur') })).catch(() => null);
    if (!chart || chart.cls.includes('est') || chart.cells !== 169 || !chart.cur) bad.push(tag + ' chart: ' + JSON.stringify(chart));
    // 3) the button starts the range building
    await p.click('#pf-estOpen'); await p.waitForTimeout(80);
    const head = await p.$eval('#pf-rov .rovhead b', e => e.textContent).catch(() => '');
    if (!re.test(head)) bad.push(tag + ' header: ' + head);
    if (!(await vis('.estgrid'))) bad.push(tag + ' no estimation grid');
    await p.click('#pf-estGo'); await p.waitForTimeout(80);
    const res = await p.$eval('#pf-rov', e => ({ h: e.querySelector('.rovhead b').textContent, info: e.querySelector('.rovinfo').innerText }));
    if (!/一致度 0%/.test(res.h)) bad.push(tag + ' empty guess should score 0%: ' + res.h);
    const tt = +(res.info.match(/正解レンジ ([\d.]+)%/) || [0, -1])[1];
    if (kind === 'call4' && Math.abs(tt - EXPECT4) > 0.3) bad.push('call4 width ' + tt + ' != ' + EXPECT4);
    if (kind !== 'call4' && !(tt > 0 && tt < 60)) bad.push(tag + ' width ' + tt);
    // the villain's full action chart (call / raise / all-in / fold), to see what else those hands do when the call range is off
    const allBtn = await p.$('#pf-rov .estv button[data-v="all"]');
    if (!allBtn) bad.push(tag + ' no 全アクション view button');
    else {
      await allBtn.click(); await p.waitForTimeout(60);
      const all = await p.$eval('#pf-rov', e => ({ cells: e.querySelectorAll('.grid13 button').length, info: e.querySelector('.rovinfo').innerText }));
      if (all.cells !== 169) bad.push(tag + ' all-actions cells ' + all.cells);
      if (!/コール/.test(all.info) || !/フォールド/.test(all.info)) bad.push(tag + ' all-actions legend/summary: ' + all.info);
      if (kind === 'call4' && !/オールイン/.test(all.info)) bad.push(tag + ' call4 all-actions lacks オールイン: ' + all.info);
      await p.click('#pf-rov .grid13 button[data-k="AA"]');
      const one = await p.$eval('#pf-rov .rovinfo', e => e.innerText);
      if (!/AA/.test(one)) bad.push(tag + ' cell tap shows nothing: ' + one);
    }
    if (!(await vis('#pf-btnNext'))) bad.push(tag + ' no next button after the answer check');
    await p.click('#pf-btnNext'); await p.waitForTimeout(80);
  }
}
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad.slice(0, 12)); process.exit(1); } else console.log('ok');
