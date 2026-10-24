// Phone (390px): the ring analysis screen must not be wider than the screen (a table inside a two-column block used to stretch the whole page); wide tables scroll inside their own box.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const fails = [];
for (const w of [360, 390, 600]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: 844 } })).newPage();
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && typeof MT.lobby === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    localStorage.clear(); Nav.setScreen('ring'); S.autoHero = true; document.getElementById('optAuto').checked = false; document.getElementById('optFast').checked = true;
    for (let k = 0; k < 20; k++) await playHand(); S.autoHero = false;
    document.querySelector('#tab-ring .subtabs [data-tab=stats]').click(); await new Promise(r => setTimeout(r, 400));
    const over = document.documentElement.scrollWidth - innerWidth;
    const tabs = [...document.querySelectorAll('#tab-stats .tscroll')];
    const scrollable = tabs.filter(t => t.scrollWidth > t.clientWidth + 1).length;
    const blocks = [...document.querySelectorAll('#tab-stats section.block')].filter(s => s.getBoundingClientRect().right > innerWidth + 1).length;
    return { over, blocks, tables: tabs.length, scrollable };
  });
  if (r.over > 0) fails.push(`${w}px: page is ${r.over}px wider than the screen`);
  if (r.blocks) fails.push(`${w}px: ${r.blocks} block(s) stick out of the screen`);
  if (!r.tables) fails.push(`${w}px: no tables rendered`);
  console.log(w, JSON.stringify(r));
}
await browser.close();
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : 'ok stats-overflow');
process.exit(fails.length ? 1 : 0);
