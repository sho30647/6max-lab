// River gap: how far a ring bot version is from the equilibrium on the river (docs/bot-lab/policy.md 4.0), measured exactly, not by bb/100 against exploiters.
// In self-play (all seats play <ver>), every heads-up river where the out-of-position player checked to the player in position is a node.
// At a node the game is the half street that follows: IP checks or bets one of the sizes (x pot), OOP calls or folds. The two ranges are the ones the
// bots read at that point (the public estimates p[rwk], the same ones the bots decide with), so the game is the one the bot itself believes it is in.
//   - the bot's strategy: each combo of each range is put in the bot's hand and botPostflopV3 asked K times (IP: check / which size; OOP: call or fold
//     to each size, after the bet has narrowed IP's range as in the real game)
//   - the equilibrium: CFR+ on the same game (exact showdowns, card removal)
//   - the gap (in % of the pot): IP gap = the game value for IP - what the bot's IP strategy gets against OOP's best response;
//     OOP gap = what IP's best response gets against the bot's OOP strategy - the game value. 0 = the bot plays an equilibrium; the sum is the exploitability.
// The ranges are the bots' estimates, not the true distribution of the hands, so a gap of 0 means "plays the equilibrium of what it reads".
// Usage: node tests/ring-river-gap.mjs [ver=12] [nodes=20] [seed=1] [K=6]      (ver can carry tweaks: "12+riverBluff=3")
// Output: per node and in total: the gaps, IP's bet frequency and bluff share per size (bot / equilibrium), OOP's fold frequency per size (bot / equilibrium).
import { createRequire } from 'module';
import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const html = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html');
const FIREBASE_STUB = `window.firebase=(function(){const user={uid:'test',displayName:'Tester',email:'t@example.com',isAnonymous:false};const doc=()=>({get:async()=>({exists:false,data:()=>null}),set:async()=>{},delete:async()=>{}});const auth=()=>({onAuthStateChanged:cb=>{setTimeout(()=>cb(user),0);return()=>{};},currentUser:user,signOut:async()=>{},signInAnonymously:async()=>user});auth.GoogleAuthProvider=function(){};return{initializeApp(){},auth,firestore:()=>({doc,collection:()=>({get:async()=>({docs:[]}),doc})})};})();`;
const [VER = '12', NODES = '20', SEED = '1', KS = '6'] = process.argv.slice(2);
const SIZES = [0.33, 0.5, 1, 1.5, 2];
const browser = await chromium.launch((P => require('fs').existsSync(P) ? { executablePath: P } : {})('/opt/pw-browsers/chromium-1194/chrome-linux/chrome'));   // the pinned browser where it exists, else Playwright's own
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); if (u.includes('gstatic.com/firebasejs')) return r.fulfill({ contentType: 'text/javascript', body: u.endsWith('firebase-app-compat.js') ? FIREBASE_STUB : '' }); return u.startsWith('file:') ? r.continue() : r.abort(); });
await page.addInitScript(() => { window.__noPopup = true; const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, 0, ...a); });
await page.goto('file://' + html);
await page.waitForFunction(() => typeof playHand === 'function' && window.PFRanges && PFRanges.spot && typeof Store !== 'undefined' && Store.mode, null, { timeout: 20000 });
await page.waitForTimeout(1500);

// 1. collect the nodes in the browser: the ranges, the showdown matrix and the bot's strategy
const nodes = await page.evaluate(async ([VER, NODES, SEED, K, SIZES]) => {
  const seed = a => { Math.random = function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; };
  crypto.getRandomValues = a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 4294967296); return a; };
  document.getElementById('optAuto').checked = false; document.getElementById('optAutoFold').checked = false; document.getElementById('optRange').checked = false;
  S.autoHero = true;
  S.players.forEach(p => { p.style = { loose: 1, aggr: 1, three: 1 }; });
  const [v, ...tw] = VER.split('+');
  const twObj = tw.length ? Object.assign({}, BOT_TWEAKS[v], ...tw.map(t => { const [k, x] = t.split('='); return { [k]: x === undefined ? true : +x }; })) : null;
  const X = twObj || BOT_TWEAKS[v] || {};
  const RWK = X.barrelRead ? 'rw3' : X.sizeRange ? 'rw2' : 'rw';
  const MAXC = 300;   // combos kept per range (the heaviest ones, about all of the weight)
  const out = [];
  const rangeOf = (p, dead) => {   // [{i, a, b, w}] the heaviest combos of p's public range, weights normalised
    const rwa = p[RWK] || p.rw, items = [];
    for (let i = 0; i < ALL.length; i++) { const w = rwa[i]; if (w <= 0.002) continue; const c = ALL[i]; if (dead[c.a] || dead[c.b]) continue; items.push({ i, a: c.a, b: c.b, w }); }
    items.sort((x, y) => y.w - x.w); const kept = items.slice(0, MAXC), t = kept.reduce((s, x) => s + x.w, 0), all = items.reduce((s, x) => s + x.w, 0);
    kept.forEach(x => x.w /= t); return { kept, cover: t / all };
  };
  const snap = p => ({ hole: p.hole.slice(), bet: p.bet, stack: p.stack, postAggr: p.postAggr, rw: p.rw && p.rw.slice(), rw2: p.rw2 && p.rw2.slice(), rw3: p.rw3 && p.rw3.slice(), rc: p.rc, rc2: p.rc2, rc3: p.rc3, contrib: p.contrib, allIn: p.allIn, acted: p.acted });
  const back = (p, s) => { Object.assign(p, s, { hole: s.hole.slice(), rw: s.rw && s.rw.slice(), rw2: s.rw2 && s.rw2.slice(), rw3: s.rw3 && s.rw3.slice() }); };
  const sizeIdx = f => { let b = 0; for (let k = 1; k < SIZES.length; k++) if (Math.abs(SIZES[k] - f) < Math.abs(SIZES[b] - f)) b = k; return b; };
  function capture(ipSeat) {
    const ip = S.players[ipSeat], oopSeat = S.players.findIndex((q, i) => i !== ipSeat && !q.folded), oop = S.players[oopSeat];
    const pot = potTotal(); if (Math.min(ip.stack, oop.stack) < 2.2 * pot) return null;   // deep enough for every size (no all-ins)
    const dead = new Uint8Array(52); S.board.forEach(c => dead[c] = 1);
    const RI = rangeOf(ip, dead), RO = rangeOf(oop, dead);
    const gS = { currentBet: S.currentBet, raiseCount: S.raiseCount, lastAggr: S.lastAggr, minRaise: S.minRaise };
    const sI = snap(ip), sO = snap(oop);
    // IP: check or a size, K asks per combo
    const ipStrat = RI.kept.map(c => { const n = new Array(SIZES.length + 1).fill(0); ip.hole = [c.a, c.b];
      for (let k = 0; k < K; k++) { const d = botPostflopV3(ipSeat); if (d.act === 'raise') n[1 + sizeIdx(d.to / pot)]++; else n[0]++; }
      return n.map(x => x / K); });
    back(ip, sI);
    // OOP: call or fold to each size, after the bet narrowed IP's range as in applyAction
    const oopCall = SIZES.map(f => {
      const amt = r5(pot * f);
      S.currentBet = amt; S.raiseCount = 1; S.lastAggr = ipSeat; S.minRaise = amt;
      ip.stack -= amt; ip.bet += amt; ip.contrib += amt; ip.postAggr++;
      narrowRange(ip, 'bet', 0, null);
      const r = RO.kept.map(c => { oop.hole = [c.a, c.b]; let n = 0; for (let k = 0; k < K; k++) if (botPostflopV3(oopSeat).act !== 'fold') n++; return n / K; });
      back(ip, sI); back(oop, sO); Object.assign(S, gS);
      return r;
    });
    back(oop, sO);
    // showdown: +1 IP wins, 0 tie, -1 IP loses, null = the two combos share a card
    const vI = RI.kept.map(c => evalHand([c.a, c.b].concat(S.board))), vO = RO.kept.map(c => evalHand([c.a, c.b].concat(S.board)));
    const M = RI.kept.map((ci, x) => RO.kept.map((co, y) => (ci.a === co.a || ci.a === co.b || ci.b === co.a || ci.b === co.b) ? null : vI[x] > vO[y] ? 1 : vI[x] === vO[y] ? 0 : -1));
    return { board: S.board.map(cardStr).join(''), pot: pot / BB, wI: RI.kept.map(c => c.w), wO: RO.kept.map(c => c.w), cover: [RI.cover, RO.cover], M, ipStrat, oopCall, aggr: S.prevStreetAggr === ipSeat };
  }
  const orig = window.botDecide;
  let want = false;
  window.botDecide = function(seat) {
    if (out.length < NODES && S.street === 3 && S.raiseCount === 0 && S.currentBet === S.players[seat].bet && isIP(seat) && S.players.filter(q => !q.folded).length === 2) {
      const n = capture(seat); if (n) out.push(n);
    }
    return orig(seat);
  };
  S.players.forEach(p => { p.ver = +v; p.tw = twObj; });
  for (let h = 0; out.length < NODES && h < NODES * 400; h++) {
    S.resetStacks = true; S.button = h % 6; Store.hands.length = 0; seed(SEED * 7919 + h * 13);
    await playHand();
  }
  window.botDecide = orig;
  return out;
}, [VER, +NODES, +SEED, +KS, SIZES]);
if (errors.length) { console.log('page errors:', errors.slice(0, 3)); }
await browser.close();

// 2. solve each node and measure the bot. Values are IP's share of the pot (pot = 1); OOP gets 1 minus it.
function solve(nd, iters = 1500) {
  const { wI, wO, M } = nd, nI = wI.length, nO = wO.length, A = SIZES.length;
  // pay[a][x][y]: IP's value when IP takes action a (0 = check, 1.. = size) and OOP calls; fold gives IP 1
  const val = (a, r) => a === 0 ? (r + 1) / 2 : ((r + 1) / 2) * (1 + 2 * SIZES[a - 1]) - SIZES[a - 1];
  const ipReg = wI.map(() => new Float64Array(A + 1)), ipSum = wI.map(() => new Float64Array(A + 1));
  const oReg = SIZES.map(() => wO.map(() => new Float64Array(2))), oSum = SIZES.map(() => wO.map(() => new Float64Array(2)));   // [fold, call]
  const rm = r => { let t = 0; for (const x of r) t += Math.max(0, x); return t > 0 ? Array.from(r, x => Math.max(0, x) / t) : Array.from(r, () => 1 / r.length); };
  for (let it = 1; it <= iters; it++) {
    const sI = ipReg.map(rm), sO = SIZES.map((_, a) => oReg[a].map(rm));
    // IP's action values per combo
    for (let x = 0; x < nI; x++) {
      const u = new Float64Array(A + 1); let tw = 0;
      for (let y = 0; y < nO; y++) { const r = M[x][y]; if (r === null) continue; const w = wO[y]; tw += w;
        u[0] += w * val(0, r); for (let a = 1; a <= A; a++) { const c = sO[a - 1][y][1]; u[a] += w * ((1 - c) * 1 + c * val(a, r)); } }
      if (!tw) continue; let ev = 0; for (let a = 0; a <= A; a++) ev += sI[x][a] * u[a];
      for (let a = 0; a <= A; a++) { ipReg[x][a] = Math.max(0, ipReg[x][a] + wI[x] * (u[a] - ev)); ipSum[x][a] += it * wI[x] * sI[x][a]; }
    }
    // OOP's call / fold values per combo and size (OOP's value = 1 - IP's)
    for (let a = 1; a <= A; a++) for (let y = 0; y < nO; y++) {
      let reach = 0, uf = 0, uc = 0;
      for (let x = 0; x < nI; x++) { const r = M[x][y]; if (r === null) continue; const p = wI[x] * sI[x][a]; reach += p; uf += p * 0; uc += p * (1 - val(a, r)); }
      const s = sO[a - 1][y], ev = s[0] * uf + s[1] * uc;
      oReg[a - 1][y][0] = Math.max(0, oReg[a - 1][y][0] + wO[y] * (uf - ev)); oReg[a - 1][y][1] = Math.max(0, oReg[a - 1][y][1] + wO[y] * (uc - ev));
      oSum[a - 1][y][0] += it * wO[y] * s[0]; oSum[a - 1][y][1] += it * wO[y] * s[1];
    }
  }
  const norm = r => { const t = r.reduce((s, x) => s + x, 0); return t ? Array.from(r, x => x / t) : Array.from(r, () => 1 / r.length); };
  return { ipS: ipSum.map(norm), oC: SIZES.map((_, a) => oSum[a].map(r => norm(r)[1])) };
}
// IP's value of the profile (IP strategy ipS, OOP call prob oC[a][y]) and the best responses
function evalProfile(nd, ipS, oC) {
  const { wI, wO, M } = nd, A = SIZES.length;
  const val = (a, r) => a === 0 ? (r + 1) / 2 : ((r + 1) / 2) * (1 + 2 * SIZES[a - 1]) - SIZES[a - 1];
  let V = 0, Z = 0;
  for (let x = 0; x < wI.length; x++) for (let y = 0; y < wO.length; y++) { const r = M[x][y]; if (r === null) continue; const w = wI[x] * wO[y]; Z += w;
    V += w * (ipS[x][0] * val(0, r) + SIZES.reduce((s, _, k) => s + ipS[x][k + 1] * ((1 - oC[k][y]) + oC[k][y] * val(k + 1, r)), 0)); }
  return V / Z;
}
function brIP(nd, oC) {   // IP's best response to OOP's call probabilities: per combo, the best action
  const { wI, wO, M } = nd, A = SIZES.length;
  const val = (a, r) => a === 0 ? (r + 1) / 2 : ((r + 1) / 2) * (1 + 2 * SIZES[a - 1]) - SIZES[a - 1];
  return wI.map((_, x) => { const u = new Array(A + 1).fill(0);
    for (let y = 0; y < wO.length; y++) { const r = M[x][y]; if (r === null) continue; u[0] += wO[y] * val(0, r); for (let a = 1; a <= A; a++) u[a] += wO[y] * ((1 - oC[a - 1][y]) + oC[a - 1][y] * val(a, r)); }
    const b = u.indexOf(Math.max(...u)); return u.map((_, a) => a === b ? 1 : 0); });
}
function brOOP(nd, ipS) {   // OOP's best response to IP's strategy: per size and combo, call iff calling beats folding (folding gives OOP 0)
  const { wI, wO, M } = nd;
  return SIZES.map((f, k) => wO.map((_, y) => { let uc = 0;
    for (let x = 0; x < wI.length; x++) { const r = M[x][y]; if (r === null) continue; const p = wI[x] * ipS[x][k + 1]; uc += p * (((1 - r) / 2) * (1 + 2 * f) - f); }
    return uc > 1e-12 ? 1 : 0; }));
}
// frequencies: IP's bet share per size and the bluff share of it (a bluff = a combo that wins under half its showdowns against OOP's range), OOP's fold share per size
function freqs(nd, ipS, oC) {
  const { wI, wO, M } = nd;
  const eqI = wI.map((_, x) => { let s = 0, t = 0; for (let y = 0; y < wO.length; y++) { const r = M[x][y]; if (r === null) continue; s += wO[y] * (r + 1) / 2; t += wO[y]; } return t ? s / t : 0.5; });
  return SIZES.map((f, k) => { let bet = 0, bluff = 0, fold = 0;
    wI.forEach((w, x) => { bet += w * ipS[x][k + 1]; if (eqI[x] < 0.5) bluff += w * ipS[x][k + 1]; });
    wO.forEach((w, y) => fold += w * (1 - oC[k][y]));
    return { bet, bluff: bet > 0.005 ? bluff / bet : null, fold }; });
}

const pct = x => x === null ? '  - ' : (100 * x).toFixed(0).padStart(3) + '%';
let gI = 0, gO = 0;
const tot = SIZES.map(() => ({ bb: 0, be: 0, lb: 0, le: 0, fb: 0, fe: 0, nb: 0, ne: 0 }));
console.log(`river gap, ver ${VER}, ${nodes.length} nodes (seed ${SEED}, K=${KS}). Gap = % of the pot the bot gives up against a best response, compared with the equilibrium.`);
for (const nd of nodes) {
  const eq = solve(nd), V = evalProfile(nd, eq.ipS, eq.oC);
  const bI = nd.ipStrat, bO = nd.oopCall;
  const ipGap = V - evalProfile(nd, bI, brOOP(nd, bI)), oopGap = evalProfile(nd, brIP(nd, bO), bO) - V;
  const exE = evalProfile(nd, brIP(nd, eq.oC), eq.oC) - evalProfile(nd, eq.ipS, brOOP(nd, eq.ipS));   // the solver's own exploitability (should be near 0)
  gI += ipGap; gO += oopGap;
  const fb = freqs(nd, bI, bO), fe = freqs(nd, eq.ipS, eq.oC);
  fb.forEach((b, k) => { const t = tot[k], e = fe[k]; t.bb += b.bet; t.be += e.bet; t.fb += b.fold; t.fe += e.fold; if (b.bluff !== null) { t.lb += b.bluff * b.bet; t.nb += b.bet; } if (e.bluff !== null) { t.le += e.bluff * e.bet; t.ne += e.bet; } });
  console.log(`${nd.board} pot ${nd.pot.toFixed(1)}bb${nd.aggr ? ' (IP bet the turn)' : ''}  gap IP ${(100 * ipGap).toFixed(1)}% OOP ${(100 * oopGap).toFixed(1)}%  (solver ${(100 * exE).toFixed(2)}%, range cover ${nd.cover.map(c => (100 * c).toFixed(0)).join('/')}%)`);
}
const n = nodes.length || 1;
console.log(`\nmean gap (% of pot): IP ${(100 * gI / n).toFixed(1)}  OOP ${(100 * gO / n).toFixed(1)}  total ${(100 * (gI + gO) / n).toFixed(1)}`);
console.log('size   IP bets: bot / eq   bluff share: bot / eq   OOP folds: bot / eq');
SIZES.forEach((f, k) => { const t = tot[k]; console.log(`${String(f).padEnd(5)}  ${pct(t.bb / n)} / ${pct(t.be / n)}          ${pct(t.nb ? t.lb / t.nb : null)} / ${pct(t.ne ? t.le / t.ne : null)}           ${pct(t.fb / n)} / ${pct(t.fe / n)}`); });
console.log(`IP checks: bot ${pct(1 - tot.reduce((s, t) => s + t.bb, 0) / n)} / eq ${pct(1 - tot.reduce((s, t) => s + t.be, 0) / n)}`);
console.log(JSON.stringify({ kind: 'riverGap', ver: VER, nodes: nodes.length, seed: +SEED, ip: +(100 * gI / n).toFixed(2), oop: +(100 * gO / n).toFixed(2) }));
