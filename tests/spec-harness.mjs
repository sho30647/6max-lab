// Shared set-up of the spec bot's browser tests: index.html in Chromium with Firebase stubbed and the network off, timers at 0.
// openGame() -> {browser, page, errors}; the page has playHand, S, SpecBot, ... ready.
// Timers: every setTimeout runs at once, in the order set (a message, not a 0 ms timer: the browser stretches nested 0 ms timers to 4 ms,
// which was about 40 ms of waiting per hand, 9 of every 10 ms of an old-bot hand).
// All-in EV (opts.allinEV, or window.__allinEV = true later): when the betting is over before the river with two or more players left
// (all-in), each player gets the average of what he wins over every possible rest of the board (all of them on the flop and the turn,
// 600 fixed ones preflop) instead of what he wins on the one board dealt. The expected result is the same; the luck of the last cards is gone.
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
  await page.addInitScript(fastTimers);
  await page.goto('file://' + html);
  await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode && window.SpecBot, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(allinEV);
  await page.evaluate(() => {
    window.__seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
    crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
    document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
    S.autoHero = true; S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
    // a version as tests/ring-bench.mjs reads it: 'spec' (the new bot), 13 (an old version), "13+riverBluff=3" (v13 with a tweak changed)
    window.__setVer = (p, ver) => { const [v, ...tw] = String(ver).split('+'); p.ver = v === 'spec' ? 'spec' : +v; p.tw = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === undefined ? true : +x }; })) : null; };
    // every hand's traces, kept in memory for the tests (the browser keeps only the last 50 hands)
    window.__hands = []; const end = SpecBot.endHand; SpecBot.endHand = function () { const h = end.apply(this, arguments); if (h) window.__hands.push(h); return h; };
  });
  if (opts.allinEV) await page.evaluate(() => { window.__allinEV = true; });
  return { browser, page, errors };
}
// in the page, before it loads: setTimeout without the wait (and without the browser's 4 ms for nested timers)
export function fastTimers() {
  window.__noPopup = true;
  const q = [], ch = new MessageChannel();
  ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); };
  window.setTimeout = (f, ms, ...a) => { q.push(() => f(...a)); ch.port2.postMessage(0); return 0; };
}
// in the page, after it loads: the all-in EV settlement (off until window.__allinEV is true)
export function allinEV() {
  const settle0 = window.settle, act0 = window.applyAction;
  window.applyAction = function () { window.__actBoard = S.board.length; return act0.apply(this, arguments); };   // the board when the last action was taken
  const setupHand0 = window.setupHand; if (setupHand0) window.setupHand = function () { window.__actBoard = 0; return setupHand0.apply(this, arguments); };
  window.__allinCount = 0;
  window.settle = function () {
    const P = S.players, live = P.filter(p => !p.folded), n0 = window.__actBoard || 0;
    if (!window.__allinEV || live.length < 2 || n0 >= 5 || S.board.length < 5) return settle0.apply(this, arguments);
    const board = S.board.slice(), base = board.slice(0, n0), k = 5 - n0;
    const dead = new Set(P.flatMap(p => p.hole || []).concat(base)), rest = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) rest.push(c);
    const runs = [];
    if (k === 1) for (const a of rest) runs.push([a]);
    else if (k === 2) for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) runs.push([rest[i], rest[j]]);
    else {   // preflop all-in: 600 boards from a fixed stream (not the game's Math.random), the same in both plays of a duplicate deal
      let a = 0x9E3779B9 ^ P.reduce((h, p) => (p.hole || []).reduce((g, c) => Math.imul(g ^ c, 16777619), h), 2166136261);
      const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      for (let n = 0; n < 600; n++) { const d = rest.slice(); for (let i = 0; i < k; i++) { const j = i + Math.floor(r() * (d.length - i)); [d[i], d[j]] = [d[j], d[i]]; } runs.push(d.slice(0, k)); }
    }
    const st0 = P.map(p => p.stack), sum = P.map(() => 0);
    for (const run of runs) { S.board = base.concat(run); settle0.apply(this, arguments); P.forEach((p, i) => { sum[i] += p.stack - st0[i]; p.stack = st0[i]; }); }
    S.board = board; S.winners = []; S.soleWin = new Set(); S.shared = new Set();
    const out = settle0.apply(this, arguments);   // the board that was dealt: who is shown as the winner
    P.forEach((p, i) => { p.stack = st0[i] + sum[i] / runs.length; });
    window.__allinCount++;
    return out;
  };
}
