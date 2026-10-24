// Shared set-up of the spec bot's browser tests: index.html in Chromium with Firebase stubbed and the network off, timers at 0.
// openGame() -> {browser, page, errors}; the page has playHand, S, SpecBot, ... ready.
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
export const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
export async function openGame(opts = {}) {
  const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
  const page = await browser.newPage();
  if (opts.cpu) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.cpu }); }
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && /SpecBot/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
  await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode && window.SpecBot, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
    crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
    document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
    S.autoHero = true; S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
    // every hand's traces, kept in memory for the tests (the browser keeps only the last 50 hands)
    window.__hands = []; const end = SpecBot.endHand; SpecBot.endHand = function () { const h = end.apply(this, arguments); if (h) window.__hands.push(h); return h; };
  });
  return { browser, page, errors };
}
