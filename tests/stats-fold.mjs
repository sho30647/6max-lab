// Ring analysis: the detail sections are collapsed behind their headings (tap to open), the first screen keeps KPIs / insight / chart open,
// the page is far shorter than with everything open, and "すべて開く／閉じる" works.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const fails = []; const check = (ok, m) => { if (!ok) fails.push(m); };
for (const scheme of ['light', 'dark']) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme })).newPage();
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    localStorage.clear(); Nav.setScreen('ring'); S.autoHero = true; document.getElementById('optAuto').checked = false; document.getElementById('optFast').checked = true;
    for (let k = 0; k < 20; k++) await playHand(); S.autoHero = false;
    document.querySelector('#tab-ring .subtabs [data-tab=stats]').click(); await new Promise(r => setTimeout(r, 400));
    const body = document.getElementById('statsBody'), sec = () => [...body.querySelectorAll('section.block')];
    const out = {};
    out.total = sec().length;
    const heads = () => [...body.querySelectorAll('section.block > h2[aria-expanded]')];
    out.foldable = heads().length;
    out.collapsed0 = heads().filter(h => h.getAttribute('aria-expanded') === 'false').length;
    out.height0 = document.documentElement.scrollHeight;
    out.insightOpen = !!body.querySelector('section.insight') && body.querySelector('section.insight').getBoundingClientRect().height > 60;
    const h = heads()[0], s = h.parentElement, hiddenBefore = s.querySelector('.tscroll,table,svg,.grid13') ? [...s.querySelectorAll('.tscroll,table,svg,.grid13')].every(e => e.offsetParent === null) : null;
    out.hiddenBefore = hiddenBefore; out.tap = Math.round(h.getBoundingClientRect().height);
    h.click(); await new Promise(r => setTimeout(r, 100));
    out.openedExpanded = h.getAttribute('aria-expanded'); out.shownAfter = [...s.querySelectorAll('.tscroll,table,svg,.grid13')].some(e => e.offsetParent !== null);
    // stays open when the filter re-renders the screen
    document.getElementById('fRange').value = '0'; document.getElementById('fRange').dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200));
    out.keptOpen = heads().filter(x => x.getAttribute('aria-expanded') === 'true').length;
    const all = [...body.querySelectorAll('button')].find(b => /すべて開く/.test(b.textContent)); out.hasAll = !!all;
    if (all) { all.click(); await new Promise(r => setTimeout(r, 150)); out.openAll = heads().every(x => x.getAttribute('aria-expanded') === 'true'); out.heightAll = document.documentElement.scrollHeight;
      const close = [...body.querySelectorAll('button')].find(b => /すべて閉じる/.test(b.textContent)); if (close) { close.click(); await new Promise(r => setTimeout(r, 150)); out.closedAll = heads().every(x => x.getAttribute('aria-expanded') === 'false'); } }
    return out;
  });
  console.log(scheme, JSON.stringify(r));
  check(r.foldable >= 10, `${scheme}: only ${r.foldable} foldable sections`);
  check(r.collapsed0 === r.foldable, `${scheme}: sections are not collapsed at first (${r.collapsed0}/${r.foldable})`);
  check(r.height0 < 2600, `${scheme}: page is ${r.height0}px tall with everything folded`);
  check(r.insightOpen, `${scheme}: insight block not visible`);
  check(r.hiddenBefore !== false, `${scheme}: a folded section still shows its table`);
  check(r.tap >= 44, `${scheme}: heading tap target ${r.tap}px < 44`);
  check(r.openedExpanded === 'true' && r.shownAfter, `${scheme}: tapping a heading does not open the section`);
  check(r.keptOpen >= 1, `${scheme}: open state lost when the filter re-renders`);
  check(r.hasAll && r.openAll && r.closedAll, `${scheme}: すべて開く/閉じる does not work`);
}
await browser.close();
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ok stats-fold');
process.exit(fails.length ? 1 : 0);
