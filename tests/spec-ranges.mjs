// Spec bot, stage 2 (docs/bot_rebuild_plan.md §6): the preflop ranges by line and the range updates (docs/postflop_spec.md §3, §7).
// node:    1. the bucket rules of §7 (the B3 / B4 overlap goes to B4; no B4 on the river)
//          2. a line's range is the product of its actions' frequencies, the same for every combo of a class
//          3. an update multiplies by the bucket's row, never goes below floor x the flop weight, never brings back a zero
// browser: 4. BTN open vs BB call from the game's charts: the weight of every class = the chart's frequency (open.BTN r+j, vsOpen BBvsBTN c)
//          5. K72 rainbow, BTN vs BB single-raised pot: the BTN range is ahead (§5's check: the raiser has the range advantage here)
//          6. a big bet of the BTN moves its range to B1 and out of B3 (the row betBig: B1 1.0, B3 0.1)
//          7. in played hands, the bot's ranges at the flop are the product of the players' chart actions (every live player)
// Usage: node tests/spec-ranges.mjs
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js'), PF = require('../bot/spec/preflop.js'), RG = require('../bot/spec/ranges.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const b = { b1: 0.8, b2: 0.6, b3: 0.4, drawMaxE: 0.5, devD: 0.2 };
// 1.
check(RG.bucketOf(0.85, 0, false, b) === 1 && RG.bucketOf(0.65, 0.5, false, b) === 2, 'B1 / B2');
check(RG.bucketOf(0.45, 0.25, false, b) === 4, 'E 45% D 25%: B4 (overlap)');
check(RG.bucketOf(0.55, 0.25, false, b) === 3, 'E 55% D 25%: B3 (B4 needs E < 50%)');
check(RG.bucketOf(0.30, 0.25, false, b) === 4 && RG.bucketOf(0.30, 0.1, false, b) === 5, 'B4 / B5 below 40%');
check(RG.bucketOf(0.45, 0.25, true, b) === 3 && RG.bucketOf(0.30, 0.25, true, b) === 5, 'river: no B4');
// 2.
{
  const open = { r: new Map([['AKs', 1], ['72o', 0.5]]), c: new Map(), j: new Map() };
  const vs3 = { r: new Map(), c: new Map([['AKs', 0.4], ['72o', 1]]), j: new Map([['AKs', 0.6]]) };
  const W = PF.rangeOf([{ spot: open, act: 'raise' }, { spot: vs3, act: 'call' }]);
  const AKs = [], s72 = [];
  for (let i = 0; i < C.NC; i++) { if (C.CLASS[i] === 'AKs') AKs.push(W[i]); if (C.CLASS[i] === '72o') s72.push(W[i]); }
  check(AKs.length === 4 && AKs.every(x => Math.abs(x - 0.4) < 1e-6), 'AKs = 1 x 0.4: ' + AKs);
  check(s72.length === 12 && s72.every(x => Math.abs(x - 0.5) < 1e-6), '72o = 0.5 x 1: ' + s72);
  check(PF.actionFreq(vs3, 'raise', 'AKs') === 0.6 && PF.actionFreq(open, 'check', '72o') === 0.5, 'raise = r + j; check = 1 - r - j');
}
// 3.
{
  const H = new RG.HandRanges(P.DEFAULTS);
  const W = new Float32Array(C.NC).fill(1); H.setPre(0, W); H.setPre(1, W);
  H.startStreet(3, C.parseCards('Kc7d2h4s9c'));   // river: quick
  const w0 = Float32Array.from(H.W[0]);
  for (let k = 0; k < 6; k++) H.apply(0, [0.1, 0.1, 0.1, 0.1, 0.1]);
  let below = 0, revived = 0; for (let i = 0; i < C.NC; i++) { if (w0[i] > 0 && H.W[0][i] < 0.02 * w0[i] - 1e-9) below++; if (w0[i] === 0 && H.W[0][i] > 0) revived++; }
  check(below === 0, 'weights below the floor: ' + below);
  check(revived === 0, 'zero weights brought back: ' + revived);
}

// browser part
const req = createRequire('/opt/node-tools/node_modules/');
const { chromium } = req('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode && window.SpecBot, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const out = await page.evaluate(async () => {
  const toSpot = T => { const r = new Map(), c = new Map(), j = new Map(); for (const k in T.h) { const x = T.h[k]; if (+x.r > 0) r.set(k, +x.r); if (+x.c > 0) c.set(k, +x.c); if (+x.j > 0) j.set(k, +x.j); } return { r, c, j }; };
  const open = toSpot(PFRanges.spot('open', 'BTN')), vs = toSpot(PFRanges.spot('vsOpen', 'BBvsBTN'));
  const btn = SpecPreflop.rangeOf([{ spot: open, act: 'raise' }]), bb = SpecPreflop.rangeOf([{ spot: vs, act: 'call' }]);
  // 4. class weights = the chart
  let bad4 = 0; for (let i = 0; i < 1326; i++) { const k = SpecCards.CLASS[i]; const e1 = Math.min(1, (open.r.get(k) || 0) + (open.j.get(k) || 0)), e2 = vs.c.get(k) || 0; if (Math.abs(btn[i] - e1) > 1e-6 || Math.abs(bb[i] - e2) > 1e-6) bad4++; }
  const width = W => { let t = 0; for (let i = 0; i < 1326; i++) t += W[i]; return t / 1326; };
  // 5. K72r
  const H = new SpecRanges.HandRanges(SpecParams.DEFAULTS); H.setPre(0, btn); H.setPre(1, bb);
  H.startStreet(1, SpecCards.parseCards('Ks7d2h'));
  const avgEq = s => { let a = 0, t = 0; const W = H.W[s], e = H.cache[s].eq; for (let i = 0; i < 1326; i++) if (W[i] > 0 && e[i] >= 0) { a += W[i] * e[i]; t += W[i]; } return a / t; };
  const ra = avgEq(0) - 0.5, raBB = avgEq(1) - 0.5;
  // 6. a big bet
  const before = H.bucketShares(0), upd = H.apply(0, SpecRanges.betMult(SpecParams.DEFAULTS.equilibrium.updateMult, 1.0));
  // 7. played hands: the bot's flop ranges = the products of the chart actions
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true; S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; p.ver = 'spec'; });
  let checked = 0, bad7 = 0, lines = {};
  const origEnd = SpecBot.endHand;
  for (let d = 0; d < 80 && checked < 25; d++) {
    S.resetStacks = true; S.button = d % 6; Store.hands.length = 0; seed(777 + d * 31);
    let snap = null;
    SpecBot.endHand = function () {
      for (const [, v] of SpecBot.views) { const H2 = v.ranges; if (H2.street >= 1) snap = { seats: H2.seats(), W0: Object.fromEntries(Object.entries(H2.W0).map(([s, W]) => [s, Array.from(W)])), board: S.board.slice(0, 3), acts: Object.fromEntries(Object.entries(SpecBot.preActs).map(([s, a]) => [s, a])) }; }
      return origEnd.apply(this, arguments);
    };
    await playHand();
    if (!snap) continue;
    checked++;
    for (const s of Object.keys(snap.W0)) {
      const acts = snap.acts[s] || [], W = SpecPreflop.rangeOf(acts), dead = new Set(snap.board);
      lines[acts.map(a => a.act).join('-')] = (lines[acts.map(a => a.act).join('-')] || 0) + 1;
      for (let i = 0; i < 1326; i++) { const want = dead.has(SpecCards.CA[i]) || dead.has(SpecCards.CB[i]) ? 0 : W[i]; if (Math.abs(snap.W0[s][i] - want) > 1e-6) { bad7++; break; } }
    }
  }
  SpecBot.endHand = origEnd;
  return { bad4, wBTN: width(btn), wBB: width(bb), ra, raBB, before, upd, checked, bad7, lines };
});
check(out.bad4 === 0, 'class weights differ from the chart: ' + out.bad4);
check(out.ra > 0.02 && out.raBB < -0.02, `K72r: BTN range equity - 50% = ${(out.ra * 100).toFixed(1)}pt, BB ${(out.raBB * 100).toFixed(1)}pt`);
check(out.upd.after[0] > out.before[0] && out.upd.after[2] < out.before[2] * 0.5, 'big bet: B1 up, B3 down ' + JSON.stringify(out.upd));
check(out.checked >= 10 && out.bad7 === 0, `played hands: ${out.checked} flops, ranges not equal to the chart products ${out.bad7}`);
check(errors.length === 0, 'page errors: ' + errors.slice(0, 3).join(' | '));
console.log(`BTN open ${(out.wBTN * 100).toFixed(1)}% of combos, BB call ${(out.wBB * 100).toFixed(1)}%; K72r BTN ${(out.ra * 100).toFixed(1)}pt / BB ${(out.raBB * 100).toFixed(1)}pt; lines ${JSON.stringify(out.lines)}`);
console.log(fails ? `${fails} failed` : 'spec-ranges: all passed');
await browser.close();
process.exit(fails ? 1 : 0);
