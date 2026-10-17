// Range estimation special: "コール" kind — estimate the range the opener CALLS WITH after the hero's 3bet (open range × the opener's call frequency vs that 3bet).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'T',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const EXPECT4 = 4.82;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 900, height: 900 } }); const bad = []; p.on('pageerror', e => bad.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); }); p.on('pageerror', e => console.log('PAGEERROR', e.message));
await p.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await p.goto('file://' + html);
await p.waitForFunction(() => typeof Nav !== 'undefined' && Nav.pfGo); await p.waitForTimeout(1500);
await p.evaluate(() => { localStorage.clear(); });
await p.evaluate(() => Nav.setScreen && Nav.setScreen('pf'));
await p.evaluate(() => Nav.pfGo('special', 'range')); await p.waitForTimeout(300);
const sel = await p.$('#pf-estKind');
if (!sel) { bad.push('#pf-estKind (推定する対象) が無い'); }
else {
  await p.click('#pf-setbox summary'); await p.selectOption('#pf-estKind', 'call'); await p.click('#pf-setbox summary');
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    await p.click('#pf-controls [data-a="F"]'); await p.waitForTimeout(100);
    const head = await p.$eval('#pf-rov .rovhead b', e => e.textContent).catch(() => '');
    const msg = await p.$eval('#pf-tablebox .seat .act', e => e.textContent).catch(() => '');
    if (!/コールするレンジ/.test(head)) bad.push('header #' + i + ': ' + head);
    seen.add(head);
    await p.click('#pf-estGo'); await p.waitForTimeout(100);
    const res = await p.$eval('#pf-rov', e => ({ h: e.querySelector('.rovhead b').textContent, info: e.querySelector('.rovinfo').innerText, filled: [...e.querySelectorAll('.grid13 button')].length }));
    if (!/一致度 0%/.test(res.h)) bad.push('empty guess should score 0%: ' + res.h);
    const tt = +(res.info.match(/正解レンジ ([\d.]+)%/) || [0, -1])[1];
    if (!(tt > 0 && tt < 30)) bad.push('call range width looks wrong (' + tt + '%): ' + res.info);
    await p.click('#pf-btnNext');
    await p.waitForTimeout(100);
  }
  console.log([...seen].slice(0, 4));
}
// 'callo': a seat behind calls the hero's open; 'call4': BTN calls the hero's CO 4bet (the solver table: 4.8% of all combos)
for (const [kind, re] of [['callo', /あなたの(UTG|HJ|CO|BTN|SB) のオープン（[\d.]+bb）に (HJ|CO|BTN|SB|BB) がコールするレンジ/], ['call4', /あなたのCOの4ベット（[\d.]+bb）に BTN がコールするレンジ/]]) {
  await p.click('#pf-setbox summary'); await p.selectOption('#pf-estKind', kind); await p.click('#pf-setbox summary');
  for (let i = 0; i < 6; i++) {
    await p.click('#pf-controls [data-a="F"]'); await p.waitForTimeout(100);
    const head = await p.$eval('#pf-rov .rovhead b', e => e.textContent).catch(() => '');
    if (!re.test(head)) bad.push(kind + ' header: ' + head);
    await p.click('#pf-estGo'); await p.waitForTimeout(100);
    const info = await p.$eval('#pf-rov .rovinfo', e => e.innerText);
    const tt = +(info.match(/正解レンジ ([\d.]+)%/) || [0, -1])[1];
    if (kind === 'call4' && Math.abs(tt - EXPECT4) > 0.3) bad.push('call4 width ' + tt + ' != ' + EXPECT4);
    if (kind === 'callo' && !(tt > 0 && tt < 60)) bad.push('callo width ' + tt);
    await p.click('#pf-btnNext'); await p.waitForTimeout(100);
  }
}
await b.close();
if (bad.length) { console.log('PROBLEMS:', bad); process.exit(1); } else console.log('ok');
