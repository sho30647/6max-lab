// Spec bot, stage 0 (docs/bot_rebuild_plan.md §6): the new bot is plugged into the game without changing it.
// 1. ring hands with every bot on ver 'spec' end with exactly the same stacks as with every bot on v13 (stage 0 hands every decision to the old bot)
// 2. every postflop decision of a 'spec' bot leaves a trace with Step0 filled in, its decision equal to the action the game applied
// 3. the hand-over reasons are counted (limp pots, 3-bet pots with a cold caller, and 'stage0' for the rest)
// 4. the hands' traces are saved in the browser (localStorage; the cap of 50 hands is tested in node: spec-trace.mjs)
// 5. no page errors
// Usage: node tests/spec-stage0.mjs [hands=150]
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });   // (the test blocks the network: the fonts fail to load)
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode && window.SpecBot, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const N = +process.argv[2] || 150;
const out = await page.evaluate(async (N) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true; S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  // the action the game applied for each decision, to compare with the trace
  const applied = []; const orig = window.applyAction;
  async function run(ver, keep) {
    const res = [];
    for (let d = 0; d < N; d++) {
      S.players.forEach(p => { p.ver = ver; p.tw = null; });
      S.resetStacks = true; S.button = d % 6; Store.hands.length = 0; seed(4242 + d * 13);
      await playHand();
      res.push(S.players.map(p => p.stack - p.start));
      if (keep) keep();
    }
    return res;
  }
  const a = await run(13);
  let traces = [], bad = [];
  const b = await run('spec', () => {});
  // re-run the spec pass with a recorder of the game's actions to compare with the traces
  const rec = []; window.botDecide = (orig2 => function(seat){ const d = orig2(seat); if (S.street > 0) rec.push({ seat, act: d.act, to: d.to || 0 }); return d; })(window.botDecide);
  const dec0 = SpecBot.counts.decisions; localStorage.removeItem('spec_traces__' + UserGate.safe(UserGate.get() || ''));   // only the next 30 hands (a hand with no postflop decision of the bot saves nothing)
  for (let d = 0; d < 30; d++) {
    S.players.forEach(p => { p.ver = 'spec'; p.tw = null; });
    S.resetStacks = true; S.button = d % 6; Store.hands.length = 0; seed(4242 + d * 13);
    await playHand();
  }
  const saved = JSON.parse(localStorage.getItem('spec_traces__' + UserGate.safe(UserGate.get() || '')) || '[]');
  const flat = saved.flatMap(h => h.records);
  const last30 = flat;
  for (let i = 0; i < Math.min(last30.length, rec.length); i++) {
    const t = last30[i], r = rec[i];
    if (t.seat !== r.seat || t.decision.act !== r.act || (t.decision.to || 0) !== r.to) bad.push([i, t.seat, r.seat, t.decision, r]);
  }
  const noStep0 = flat.filter(t => !t.step0 || !t.step0.potType || !t.step0.nodeKind).length;
  const missing = flat.filter(t => SpecTrace.missing(t).length).length;
  return { dDec: SpecBot.counts.decisions - dec0, same: JSON.stringify(a) === JSON.stringify(b), handsSaved: saved.length, traces: flat.length, recLen: rec.length, last30: last30.length, bad: bad.slice(0, 3), nBad: bad.length,
    noStep0, missing, counts: SpecBot.counts, kinds: flat.reduce((m, t) => (m[t.step0.potType + '/' + t.step0.nodeKind] = (m[t.step0.potType + '/' + t.step0.nodeKind] || 0) + 1, m), {}) };
}, N);
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
check(out.same, 'spec (stage 0) and v13 end with different stacks');
check(out.handsSaved > 0 && out.handsSaved <= 30, 'saved hands ' + out.handsSaved);
check(out.last30 === out.recLen, `traces of the last 30 hands ${out.last30} vs postflop decisions ${out.recLen}`);
check(out.nBad === 0, 'trace decision differs from the applied one: ' + JSON.stringify(out.bad));
check(out.noStep0 === 0 && out.missing === 0, `traces without step0 ${out.noStep0}, incomplete ${out.missing}`);
check(errors.length === 0, 'page errors: ' + errors.slice(0, 3).join(' | '));
console.log('counts', JSON.stringify(out.counts), '\nkinds', JSON.stringify(out.kinds));
console.log(fails ? `${fails} failed` : 'spec-stage0: all passed');
await browser.close();
process.exit(fails ? 1 : 0);
