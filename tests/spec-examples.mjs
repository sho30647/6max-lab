// Spec bot: the spec's own worked examples (docs/postflop_spec.md).
// 1. §8's table of action probabilities with tau = 2% of the pot: delta +8% -> bet 100%, +1% -> bet 75% / check 25%, -5% -> check 100%
// 2. §9's example: on the river a made flush is raised; against the original range it wins ~85%, against the raising range (higher flushes and
//    full houses) far less, and with a price of 30% the bot folds (the decision follows the narrowed range, not the original one)
// 3. §8's geometric size: pot 10bb, stack 95bb, 3 streets -> about 86% of the pot each time
// Usage: node tests/spec-examples.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js'), E = require('../bot/spec/equity.js'), RG = require('../bot/spec/ranges.js'), ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };

// 1.
{
  const ctx = { prm: P.DEFAULTS, P: 1000 };
  const pr = d => ST.probs(ctx, { evCheck: 0, bets: [{ EV: d * 1000, reason: 'value' }] }, 0).p;
  const a = pr(0.08), b = pr(0.01), c = pr(-0.05);
  check(a[1] === 1 && a[0] === 0, 'delta +8%: bet 100% ' + a);
  check(Math.abs(b[1] - 0.75) < 1e-9 && Math.abs(b[0] - 0.25) < 1e-9, 'delta +1%: bet 75% / check 25% ' + b);
  check(c[0] === 1 && c[1] === 0, 'delta -5%: check 100% ' + c);
}
// 2.
{
  const board = C.parseCards('Ah9h4h2cKd'), hole = C.parseCards('7h6h');
  const all = new Float32Array(C.NC).fill(1);
  // the raising range: the higher flushes (Qh, Jh, Th, 8h with any other card) and the full houses (AA, KK, 99, 44, 22, A9, AK, K9...)
  const raise = new Float32Array(C.NC);
  for (let i = 0; i < C.NC; i++) {
    const a = C.CA[i], b = C.CB[i];
    if ([a, b].some(c => board.includes(c) || hole.includes(c))) continue;
    const v = C.evalHand([a, b].concat(board)), mine = C.evalHand(hole.concat(board));
    if (v > mine) raise[i] = 1;   // every hand that beats the bot's flush
  }
  // a few bluffs, as the update table keeps some (B5 x 0.1 after a raise)
  let nB = 0; for (let i = 0; i < C.NC && nB < 3; i++) { const a = C.CA[i], b = C.CB[i]; if ([a, b].some(c => board.includes(c) || hole.includes(c))) continue; if (C.evalHand([a, b].concat(board)) >> 20 <= 1 && !raise[i]) { raise[i] = 1; nB++; } }
  const H = new RG.HandRanges(P.DEFAULTS);
  const me = C.comboOf(hole[0], hole[1]);
  // the bot's range: its flushes and better, sets and two pairs (it bet the river for value), and its own hand
  const mine = new Float32Array(C.NC); for (let i = 0; i < C.NC; i++) { const a = C.CA[i], b = C.CB[i]; if ([a, b].some(c => board.includes(c))) continue; if (C.evalHand([a, b].concat(board)) >> 20 >= 2) mine[i] = 1; } mine[me] = 1;
  H.setPre(0, mine); H.setPre(1, raise); H.startStreet(3, board);
  const vsAll = E.handExact(hole, board, all).eq, vsRaise = E.handExact(hole, board, raise).eq;
  const toCall = 3000, pot = 7000;   // a price of 30% (3000 to win the 7000 + 3000 after the call)
  const tr = {};
  const ctx = { prm: P.DEFAULTS, seat: 0, street: 3, board, hole, own: me, P: pot, toCall, stack: 20000, myBet: 1000, currentBet: 4000, effStack: 20000, ip: true,
    nodeKind: 'facingRaise', nOpp: 1, H, Wme: H.W[0], Wop: H.W[1], WopRaw: H.W[1], rng: () => 0.99, tr, bb: 100, sprClass: 'mid' };
  ST.prepare(ctx);
  const d = ST.facing(ctx);
  check(vsAll > 0.80, `the flush against every hand: ${(vsAll * 100).toFixed(1)}% (> 80%)`);
  check(vsRaise < 0.30, `against the raising range: ${(vsRaise * 100).toFixed(1)}% (< 30%)`);
  check(d.act === 'fold', `facing the raise at a 30% price: ${d.act} (want fold); trace ${JSON.stringify(tr.step7)}`);
  console.log(`§9: the flush wins ${(vsAll * 100).toFixed(1)}% against every hand, ${(vsRaise * 100).toFixed(1)}% against the raising range, price 30% -> ${d.act}`);
}
// 3.
{
  const geo = (S, Pp, n) => (Math.pow(1 + 2 * S / Pp, 1 / n) - 1) / 2;
  const f = geo(95, 10, 3);
  check(Math.abs(f - 0.86) < 0.01, 'geometric size ' + f.toFixed(3));
}
console.log(fails ? `${fails} failed` : 'spec-examples: all passed');
process.exit(fails ? 1 : 0);
