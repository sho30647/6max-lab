// Ring spots: how a ring bot version decides in the spots the owner noted (docs/bot-lab/owner-notes.md N2-N4), measured in self-play (all seats play <ver>).
// Whenever a bot faces a single bet after the flop, heads-up, it records the decision, the hand's class and the "check-down EV" of calling
// (what the call earns if no more chips go in, from the actual cards of the bettor: for measurement only, the bot never sees them).
//   N2: turn, facing a bet under 45% of the pot: how often it folds each hand class (overpair, top pair, ...) and what the folds would have earned.
//   N3: flop, facing a bet under 45% of the pot: how often high-card hands call, with / without a backdoor flush draw, and what the calls earn.
//   N4: how often it raises a bet, by street, and how many of those raises are bluffs (a raise with under 40% equity against the actual hand).
//   Step 2 of the owner's theory (policy 8.3, 2): how well the bot's strength order (its percentile in its own range) predicts the hand's equity against
//   the bettor's actual hand (Spearman rank correlation), and the "misfold / miscall" loss: the check-down EV of the hands it folded when the call
//   would have earned (sum of the positive EVs), of the hands it called when the call lost (sum of the negative EVs), per decision.
// Usage: node tests/ring-spots.mjs [ver=7] [hands=3000] [seed=1]
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const [VER, N, SEED] = [process.argv[2] || '7', +process.argv[3] || 3000, +process.argv[4] || 1];
const out = await page.evaluate(async ([VER, N, SEED]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const rank = c => c >> 2, suit = c => c & 3;
  // hand class on this board: overpair = a pocket pair above every board card (also on a paired board), else by the made hand
  function handClass(hole, board) {
    const [r0, r1] = [rank(hole[0]), rank(hole[1])], br = board.map(rank), maxB = Math.max(...br), cat = evalHand(hole.concat(board)) >> 20;
    if (r0 === r1 && r0 > maxB) return 'overpair';
    if (cat >= 3) return 'trips+';
    if (cat === 2) return 'twopair';
    if (cat === 1) { if (r0 === r1) return 'underpair'; const m = br.includes(r0) ? r0 : br.includes(r1) ? r1 : -1; return m < 0 ? 'high' : m === maxB ? 'toppair' : 'pair'; }
    return 'high';
  }
  function bdfd(hole, board) { if (board.length !== 3) return false; for (let s = 0; s < 4; s++) { const n = hole.concat(board).filter(c => suit(c) === s).length, h = hole.filter(c => suit(c) === s).length; if (n === 3 && h >= 1) return true; } return false; }
  // the call's EV if no more chips go in, against the bettor's actual hand, over every remaining board
  function eqVsActual(hole, opp, board) {
    const used = new Set(hole.concat(opp, board)), rest = []; for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
    let w = 0, n = 0; const score = (h, b) => evalHand(h.concat(b));
    if (board.length === 5) { const a = score(hole, board), b = score(opp, board); return a > b ? 1 : a === b ? 0.5 : 0; }
    if (board.length === 4) { for (const r of rest) { const bd = board.concat([r]), a = score(hole, bd), b = score(opp, bd); w += a > b ? 1 : a === b ? 0.5 : 0; n++; } return w / n; }
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) { const bd = board.concat([rest[i], rest[j]]), a = score(hole, bd), b = score(opp, bd); w += a > b ? 1 : a === b ? 0.5 : 0; n++; }
    return w / n;
  }
  const st = {}; const get = (k, init) => st[k] || (st[k] = init());
  const orig = window.botDecide;
  window.botDecide = function(seat) {
    const p = S.players[seat], toCall = S.currentBet - p.bet, d = orig(seat);
    if (S.street > 0 && toCall > 0 && S.raiseCount === 1) {
      const opp = S.players.filter((q, i) => i !== seat && !q.folded);
      if (opp.length === 1) {
        const pot = potTotal(), pot0 = pot - S.players.reduce((a, q) => a + q.bet, 0), f = S.currentBet / pot0, street = 'FTR'[S.street - 1];
        const w = eqVsActual(p.hole, opp[0].hole, S.board), ev = (w * (pot + toCall) - toCall) / BB, act = d.act === 'raise' ? 'raise' : d.act === 'call' ? 'call' : 'fold';
        const small = S.street === 2 ? f < 0.6 : f < 0.45, cls = handClass(p.hole, S.board);   // the bots' own turn bets are 50%+: the owner's 40% turn bet (N2) is counted with them
        const add = (k, extra) => { const x = get(k, () => ({ n: 0, fold: 0, call: 0, raise: 0, evFold: 0, evCall: 0, evAll: 0, bluffRaise: 0, missFold: 0, missCall: 0 })); if (act === 'fold' && ev > 0) x.missFold += ev; if (act === 'call' && ev < 0) x.missCall -= ev; x.n++; x[act]++; x.evAll += ev; if (act === 'fold') x.evFold += ev; if (act === 'call') x.evCall += ev; if (act === 'raise' && w < 0.4) x.bluffRaise++; };
        add(`${street} ${small ? 'small' : 'big'} ${cls}`);                         // by street, bet size and hand class
        if (S.street === 1 && small && cls === 'high') { add(`F small high ${bdfd(p.hole, S.board) ? 'with-BDFD' : 'no-BDFD'}`); if (!drawFlag(p.hole[0], p.hole[1], S.board)) add(`F small high nodraw ${bdfd(p.hole, S.board) ? 'with-BDFD' : 'no-BDFD'}`); }   // N3 (nodraw: no flush / straight draw, only backdoors)
        add(`${street} all`);                                                         // N4: raise rate by street
        const q = percentileOf(p, strengthVal(p.hole[0], p.hole[1], S.board)), e = equity(seat, opp, 250), pr = get('__pairs', () => ({})); (pr[street] || (pr[street] = [])).push([q, w, e]);   // step 2: the bot's strength order against the equity
      }
    }
    return d;
  };
  for (let h = 0; h < N; h++) {
    S.players.forEach(p => { p.ver = +VER; p.tw = null; });
    S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13);
    await playHand();
  }
  window.botDecide = orig;
  return st;
}, [VER, N, SEED]);
await browser.close();
const rankOf = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = Array(v.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = prs => { if (prs.length < 10) return NaN; const a = rankOf(prs.map(x => x[0])), b = rankOf(prs.map(x => x[1])), n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
const pct = (a, n) => (n ? (100 * a / n).toFixed(0) : '-').toString().padStart(3) + '%', ev = (a, n) => (n ? (a / n).toFixed(2) : '-').toString().padStart(6);
const row = (k, x) => `${k.padEnd(28)} n=${String(x.n).padStart(5)}  fold ${pct(x.fold, x.n)}  call ${pct(x.call, x.n)}  raise ${pct(x.raise, x.n)}   EV(call) of folds ${ev(x.evFold, x.fold)}bb  of calls ${ev(x.evCall, x.call)}bb`;
console.log(`ver ${VER}, ${N} hands, seed ${SEED}: heads-up, facing a single bet after the flop (EV = the call's EV with no more chips, from the bettor's actual hand)`);
console.log('\nN2  turn, bet under 45% of the pot, by hand class');
for (const c of ['overpair', 'trips+', 'twopair', 'toppair', 'pair', 'underpair', 'high']) { const x = out[`T small ${c}`]; if (x) console.log(row(`T small ${c}`, x)); }
console.log('\nN3  flop, bet under 45% of the pot, high-card hands');
for (const k of ['F small high', 'F small high with-BDFD', 'F small high no-BDFD', 'F small high nodraw with-BDFD', 'F small high nodraw no-BDFD']) if (out[k]) console.log(row(k, out[k]));
console.log('\nN4  raises when facing a bet (bluff raise = a raise with under 40% equity against the actual hand)');
for (const s of 'FTR') { const x = out[`${s} all`]; if (x) console.log(`${s} all`.padEnd(28) + ` n=${String(x.n).padStart(5)}  raise ${pct(x.raise, x.n)}  of the raises, bluffs ${pct(x.bluffRaise, x.raise)}  (${x.bluffRaise}/${x.raise})`); }
console.log('\nStep 2  the bot\'s strength order against the equity vs the actual hand; the loss from folds that would have earned and calls that lost (per decision)');
for (const s of 'FTR') { const x = out[`${s} all`], pr = (out.__pairs || {})[s] || []; if (x) console.log(`${s}`.padEnd(4) + ` n=${String(x.n).padStart(5)}  Spearman(order,equity) ${spearman(pr.map(x => [x[0], x[1]])).toFixed(2)}  Spearman(bot's equity vs range,equity) ${spearman(pr.map(x => [x[2], x[1]])).toFixed(2)}  misfold ${(x.missFold / x.n).toFixed(2)}bb  miscall ${(x.missCall / x.n).toFixed(2)}bb  fold ${pct(x.fold, x.n)} call ${pct(x.call, x.n)} raise ${pct(x.raise, x.n)}`); }
console.log('RESULT ' + JSON.stringify(out));
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); process.exit(1); }
