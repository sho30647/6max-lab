// Spec bot, Step2 (docs/postflop_spec.md §4): the static / dynamic axis of a flop, measured as the owner decided (2026-10-26):
// for each of the 49 next cards, the share (by weight) of the bot's top 20% now (by equity) that drops out of the top 20% after that card,
// averaged over the cards. Ranges: the game's BTN open and BB call (as the game's chart gives them), the BTN side.
// 1. the fixed flops of the spec's table: A83r, K72r and KK5 static; JT9, 765 and 874 dynamic; AK5 one suit mid or static
// 2. reported: the split of 100 random flops (both sides), and the time of one step2
// 3. the turn: the bot's own turn decisions in play (4 x 100 heads-up duels) do not lean to one class (its own bounds, staticDynamicTurn); --no-play skips it
// Before the change (the mean equity moving 5pt) every flop was static, so check 1 failed on JT9 / 765 / 874.
// Usage: node tests/spec-dynamic.mjs [random flops=100]   [--no-play]
import { createRequire } from 'module';
import { openGame } from './spec-harness.mjs';
import { worker } from './eval-stats.mjs';
import { LINES } from './spec-duel.mjs';
import { fileURLToPath } from 'url'; import path from 'path';
const duel = path.join(path.dirname(fileURLToPath(import.meta.url)), 'spec-duel.mjs');
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js'), E = require('../bot/spec/equity.js'), ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
const N = +process.argv[2] || 100;
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };

// the game's ranges
const { browser, page } = await openGame();
const R = await page.evaluate(() => {
  const toSpot = T => { const r = new Map(), c = new Map(), j = new Map(); for (const k in T.h) { const x = T.h[k]; if (+x.r > 0) r.set(k, +x.r); if (+x.c > 0) c.set(k, +x.c); if (+x.j > 0) j.set(k, +x.j); } return { r, c, j }; };
  return { btn: Array.from(SpecPreflop.rangeOf([{ spot: toSpot(PFRanges.spot('open', 'BTN')), act: 'raise' }])),
    bb: Array.from(SpecPreflop.rangeOf([{ spot: toSpot(PFRanges.spot('vsOpen', 'BBvsBTN')), act: 'call' }])) };
});
await browser.close();

const live = (W, board) => { const o = new Float32Array(C.NC); for (let i = 0; i < C.NC; i++) if (!board.includes(C.CA[i]) && !board.includes(C.CB[i])) o[i] = W[i]; return o; };
let ms = 0, nT = 0;
function dynOf(board, side) {
  const Wb = live(R.btn, board), Wo = live(R.bb, board);
  const only = new Uint8Array(C.NC); for (let i = 0; i < C.NC; i++) if (Wb[i] > 0 || Wo[i] > 0) only[i] = 1;
  const T = new E.StreetTable(board, only, null);
  const [me, op] = side === 'bb' ? [Wo, Wb] : [Wb, Wo];
  const ctx = { prm: P.DEFAULTS, street: 1, board, Wme: me, swMe: T.sweep(op, true), tr: {} };
  const t0 = performance.now(); const s2 = ST.step2(ctx); ms += performance.now() - t0; nT++;
  return s2;
}
// 1.
const want = { As8d3c: ['static'], Kh7d2c: ['static'], KdKc5h: ['static'], JsTs9h: ['dynamic'], '7h6h5d': ['dynamic'], '8c7c4d': ['dynamic'], AhKh5h: ['mid', 'static'] };
for (const [b, ok] of Object.entries(want)) {
  const s2 = dynOf(C.parseCards(b), 'btn');
  console.log(`${b}  score ${(100 * s2.dynScore).toFixed(1)}%  ${s2.dyn}`);
  check(ok.includes(s2.dyn), `${b}: ${s2.dyn} (score ${(100 * s2.dynScore).toFixed(1)}%), want ${ok.join(' or ')}`);
}
// 2.
let a = 12345; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const cnt = { btn: { static: 0, mid: 0, dynamic: 0 }, bb: { static: 0, mid: 0, dynamic: 0 } };
for (let k = 0; k < N; k++) {
  const deck = [...Array(52).keys()], b = []; for (let j = 0; j < 3; j++) b.push(deck.splice((rnd() * deck.length) | 0, 1)[0]);
  for (const side of ['btn', 'bb']) cnt[side][dynOf(b, side).dyn]++;
}
for (const side of ['btn', 'bb']) console.log(`${N} random flops, ${side === 'btn' ? 'BTN (opener)' : 'BB (caller)'}: static ${cnt[side].static}, mid ${cnt[side].mid}, dynamic ${cnt[side].dynamic}`);
// 4. Step4's sizes at the RA+/NA+ point (docs/decisions.md 2026-10-27): its size is already set between static 29% and dynamic 63% by the
//    dynamic score, so the dynamic one-step shift is not added on top (before: a dynamic flop's c-bet came out at 75% / 100%, over §6's 50-75%).
//    Elsewhere the shift stays (RA+/NA- on a dynamic board: one step up), and so do the static step (static stays 25-33%), the dynamic
//    frequency step and the turn's step.
{
  const eq = P.DEFAULTS.equilibrium, th = eq.raNaThresh;
  const s4of = (ra, na, dyn, street = 1) => {
    const [lo, hi] = street === 2 ? eq.staticDynamicTurn : eq.staticDynamic;
    const ctx = { prm: P.DEFAULTS, ip: true, street, effStack: 100, P: 1, sprClass: 'high', nodeKind: 'cbet', tr: {} };
    return ST.step4(ctx, { raEff: ra * th, na: na * th }, { dyn, dynScore: dyn === 'static' ? lo - 0.05 : dyn === 'dynamic' ? hi + 0.05 : (lo + hi) / 2 });
  };
  const inR = (s, a, b) => s.sizes.every(z => z >= a - 1e-9 && z <= b + 1e-9);
  const top = s4of(1, 1, 'dynamic'), topS = s4of(1, 1, 'static'), side = s4of(1, -1, 'dynamic'), sideS = s4of(1, -1, 'static'), topT = s4of(1, 1, 'dynamic', 2);
  const f = s => `sizes ${s.sizes.map(z => (100 * z).toFixed(0) + '%').join(' / ')} freq ${(100 * s.freq).toFixed(0)}% [${s.adjust.join(',')}]`;
  console.log(`step4 RA+/NA+ flop: dynamic ${f(top)} | static ${f(topS)} | turn dynamic ${f(topT)}; RA+/NA- flop: dynamic ${f(side)} | static ${f(sideS)}`);
  check(inR(top, 0.5, 0.75), `RA+/NA+ dynamic flop: ${f(top)}, want 50-75%`);
  check(inR(topS, 0.25, 0.33), `RA+/NA+ static flop: ${f(topS)}, want 25-33%`);
  check(Math.abs(top.freq - (eq.nodeGrid.freq[2][2] - eq.stepFreq)) < 1e-9, `RA+/NA+ dynamic flop: freq ${top.freq}, want one step down`);
  check(Math.max(...topT.sizes) > Math.max(...top.sizes), `RA+/NA+ dynamic turn: ${f(topT)}, want one step over the flop's`);
  check(Math.max(...side.sizes) > Math.max(...sideS.sizes), `RA+/NA- flop: dynamic ${f(side)} not over static ${f(sideS)} (the shift stays off the top point only)`);
}
// 3. the turn (docs/decisions.md 2026-10-27): how the bot's own turn decisions split, the new bot against itself on heads-up flops (tests/spec-duel.mjs,
//    as tests/spec-theory.mjs: 4 x 100 duels, seeds 1-4). The turn has its own bounds (staticDynamicTurn): with the flop's bounds the turn leaned to
//    dynamic (9 / 47 / 44%). Check: static 10%+, dynamic 10-40%, mid 65% or less (the flop's split in the same play: about 15 / 58 / 26%).
if (!process.argv.includes('--no-play')) {
  const D = (await Promise.all([1, 2, 3, 4].map(sd => worker(duel, ['100', String(sd), JSON.stringify(LINES), 'a', 'spec', 'spec', 'ev', 'theory'])))).flatMap(x => x.rows).flatMap(r => r.th || []);
  for (const st of [1, 2]) {
    const dd = D.filter(x => x.st === st && x.dy), c = { static: 0, mid: 0, dynamic: 0 }; for (const x of dd) c[x.dy]++;
    const pc = k => (100 * c[k] / (dd.length || 1)).toFixed(1) + '%';
    console.log(`${st === 1 ? 'flop' : 'turn'} decisions in play (n=${dd.length}): static ${pc('static')}, mid ${pc('mid')}, dynamic ${pc('dynamic')}`);
    if (st === 2) { const f = k => c[k] / (dd.length || 1); check(dd.length > 300 && f('static') >= 0.10 && f('dynamic') >= 0.10 && f('dynamic') <= 0.40 && f('mid') <= 0.65, `turn in play: static ${pc('static')} mid ${pc('mid')} dynamic ${pc('dynamic')} (want static 10%+, dynamic 10-40%, mid 65% or less)`); }
  }
}
console.log(`step2: ${(ms / nT).toFixed(1)} ms per call (node)`);
console.log(fails ? `${fails} failed` : 'spec-dynamic: all passed');
process.exitCode = fails ? 1 : 0;
