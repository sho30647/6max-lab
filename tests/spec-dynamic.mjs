// Spec bot, Step2 (docs/postflop_spec.md §4): the static / dynamic axis of a flop, measured as the owner decided (2026-10-26):
// for each of the 49 next cards, the share (by weight) of the bot's top 20% now (by equity) that drops out of the top 20% after that card,
// averaged over the cards. Ranges: the game's BTN open and BB call (as the game's chart gives them), the BTN side.
// 1. the fixed flops of the spec's table: A83r, K72r and KK5 static; JT9, 765 and 874 dynamic; AK5 one suit mid or static
// 2. reported: the split of 100 random flops (both sides), and the time of one step2
// Before the change (the mean equity moving 5pt) every flop was static, so check 1 failed on JT9 / 765 / 874.
// Usage: node tests/spec-dynamic.mjs [random flops=100]
import { createRequire } from 'module';
import { openGame } from './spec-harness.mjs';
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
console.log(`step2: ${(ms / nT).toFixed(1)} ms per call (node)`);
console.log(fails ? `${fails} failed` : 'spec-dynamic: all passed');
process.exitCode = fails ? 1 : 0;
