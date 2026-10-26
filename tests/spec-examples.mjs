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
// 4. docs/hand_reviews.md #1: the turn 7c8s6hQh, the bot OOP with Ah5h (the nut flush draw, ~48% against the betting range) faces a bet of
//    2.45x the pot before it with an effective stack of 4.9 pots. After a call ~0.42 pots of stack stay behind for ~5.9 pots in the middle
//    (SPR 0.42): R and the margin shrink toward 1 and 0 (facingSprFull), so it calls. An all-in call: R = 1, margin 0. Deep: as before
{
  const board = C.parseCards('7c8s6hQh'), hole = C.parseCards('Ah5h'), me = C.comboOf(hole[0], hole[1]);
  const dead = new Set(board.concat(hole)), cls = {};
  for (let i = 0; i < C.NC; i++) { if (dead.has(C.CA[i]) || dead.has(C.CB[i])) continue; (cls[C.CLASS[i]] = cls[C.CLASS[i]] || []).push(i); }
  const W = keys => { const w = new Float32Array(C.NC); for (const k of keys) for (const i of cls[k] || []) w[i] = 1; return w; };
  // the bettor: sets, two pairs, straights, top pairs, and K-high / J-high bluffs (so the bot's hand is at ~48%)
  const opp = W(['77', '88', '66', 'QQ', 'T9s', 'T9o', '87s', '76s', 'AQs', 'AQo', 'KQs', 'KJs', 'KJo', 'KTs', 'JTs']);
  // the bot's range: its hand and enough strong hands that it defends more than the MDF (the guard stays out of it)
  const mine = W(['T9s', 'T9o', '54s', '99', 'A5s']); mine[me] = 1;
  const run = (effStack, pb, bet) => {
    const H = new RG.HandRanges(P.DEFAULTS); H.setPre(0, mine); H.setPre(1, opp); H.startStreet(2, board);
    const tr = {};
    const ctx = { prm: P.DEFAULTS, seat: 0, street: 2, board, hole, own: me, P: pb + bet, toCall: bet, stack: effStack, myBet: 0, currentBet: bet, effStack, ip: false,
      nodeKind: 'facingBet', nOpp: 1, H, Wme: H.W[0], Wop: H.W[1], WopRaw: H.W[1], rng: () => 0.99, tr, bb: 100, sprClass: 'mid' };
    ST.prepare(ctx); const d = ST.facing(ctx); return { d, s7: tr.step7, E: tr.step5.E, tr };
  };
  const a = run(4900, 1000, 2450), s = a.s7;
  check(a.E > 0.46 && a.E < 0.52, `A5hh against the betting range: ${a.E} (want ~48%)`);
  check(Math.abs(s.sprAfter - 2450 / 5900) < 0.002, `SPR after the call ${s.sprAfter} (want 0.415)`);
  check(Math.abs(s.R - (1 - 0.15 * 2450 / 5900)) < 0.002 && Math.abs(s.margin - 0.03 * 2450 / 5900) < 0.002, `R ${s.R} margin ${s.margin} (want 0.938 / 0.012)`);
  check(!s.mdfGuard, 'the MDF guard is not what decides it');
  check(a.d.act === 'call', `facing 2.45x pot with 4.9 pots behind: ${a.d.act} (want call); trace ${JSON.stringify(s)}`);
  const b = run(2450, 1000, 2450).s7;   // the bet puts the bot all-in
  check(b.sprAfter === 0 && b.R === 1 && b.margin === 0, `an all-in call: SPR ${b.sprAfter} R ${b.R} margin ${b.margin} (want 0 / 1 / 0)`);
  const c = run(30000, 1000, 2450).s7;   // deep: SPR after the call ~4.7
  check(c.sprAfter >= 1 && c.R === 0.85 && c.margin === 0.03, `deep: SPR ${c.sprAfter} R ${c.R} margin ${c.margin} (want R 0.85, margin 0.03)`);
  const e = run(5900 * 1 + 2450, 1000, 2450).s7;   // exactly SPR 1 after the call: unchanged
  check(Math.abs(e.sprAfter - 1) < 1e-3 && e.R === 0.85 && e.margin === 0.03, `SPR 1 after the call: R ${e.R} margin ${e.margin} (want 0.85 / 0.03)`);
  // the explanation's ⑦ says, in plain words, that R and the margin were made smaller because little stack is left (explain.js)
  const X = require('../bot/spec/explain.js');
  const text = tr => { try { const t = X.explain(Object.assign({ street: 2, pos: 'BB', hole, board, step0: { bb: 100, pot: 3450, toCall: 2450, nodeKind: 'facingBet', potType: 'SRP', sprClass: 'mid', spr: 2, nPlayers: 2 }, decision: { act: 'call' } }, tr), P.DEFAULTS); return t.lines.find(l => l.includes('コールに必要な勝率')) || ''; } catch (err) { return 'ERROR ' + err.message; } };
  const ta = text(a.tr), tb = text(run(2450, 1000, 2450).tr), tc = text(run(30000, 1000, 2450).tr);
  check(ta.includes('残るチップがポットの42%しかなく') && ta.includes('ふだんは実現率0.85、上乗せ3pt'), 'the explanation of the shallow call: ' + ta);
  check(tb.includes('コールするとオールイン') && tb.includes('上乗せを0にした'), 'the explanation of the all-in call: ' + tb);
  check(!tc.includes('ふだんは'), 'the explanation of the deep call says nothing of it: ' + tc);
  console.log(`hand review #1: A5hh ${(a.E * 100).toFixed(1)}%, SPR after the call ${s.sprAfter}, R ${s.R}, margin ${s.margin}, RE ${s.RE} vs ${s.cut} -> ${a.d.act}`);
}
console.log(fails ? `${fails} failed` : 'spec-examples: all passed');
process.exit(fails ? 1 : 0);
