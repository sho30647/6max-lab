// Spec bot, Step1 (docs/postflop_spec.md §3): a bet is read by its size, on a line between the table's sizes (docs/decisions.md 2026-10-27).
// The bigger the bet, the more the bettor's range is split into the strongest hands (B1) and the bluffs (B5), and the fewer hands in the middle (B2-B3).
//   1. the rows (RG.betMult): B1 never falls and B2 / B3 never rise as the size grows, the line joins the table's points, and a size under
//      the first point / over the last takes the end row
//   2. the same river range, a bet of 33% against one of 150% (HandRanges.apply): at 150% B2 + B3 weigh less, and B1 and B5 more
//   3. the read's air at a typical river betting range (PRIOR) rises with the size, toward the theory's bluff share B / (P + 2B) but not over it
//      at 75% or more (a read at the theory's share makes every bluff catcher call: docs/decisions.md 2026-10-27); the old two rows fell
//   4. strategy.js (how the others see the bot's bet, §8): a bet of 80% and one of 200% are seen as two ranges (before: one, "big")
//   5. an older params set (no betSize, tests/spec-harness.mjs SPEC_ALT) reads the two rows betSmall / betBig as before
// Before the change there was no betMult and one row for every bet of 75% or more (its read held fewer bluffs at 75% than at 33%): checks 1-4 failed.
// Usage: node tests/spec-betsize.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js'), RG = require('../bot/spec/ranges.js'), ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const um = P.DEFAULTS.equilibrium.updateMult;
const pct = x => (100 * x).toFixed(1) + '%';
if (typeof RG.betMult !== 'function' || !um.betSize) { console.log('FAIL no bet-size table (RG.betMult / updateMult.betSize)'); process.exit(1); }

// 1. the rows
const sizes = [0.2, 0.33, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 4.0], rows = sizes.map(s => RG.betMult(um, s));
const mono = (b, dir) => rows.every((r, k) => k === 0 || (dir > 0 ? r[b] >= rows[k - 1][b] - 1e-9 : r[b] <= rows[k - 1][b] + 1e-9));
check(mono(0, 1), 'B1 never falls as the bet grows: ' + rows.map(r => r[0]).join(' '));
check(mono(1, -1) && mono(2, -1), 'B2 and B3 never rise as the bet grows: ' + rows.map(r => r[1] + '/' + r[2]).join(' '));
const T = um.betSize;
check(T.at.every((s, k) => RG.betMult(um, s).every((x, b) => Math.abs(x - T.mult[k][b]) < 1e-9)), 'the table\'s points are its rows');
const mid = RG.betMult(um, (T.at[1] + T.at[2]) / 2);
check(mid.every((x, b) => Math.abs(x - (T.mult[1][b] + T.mult[2][b]) / 2) < 0.0015), 'half way between two points: the mean of their rows');
check(RG.betMult(um, 0.1) === T.mult[0] && RG.betMult(um, 9) === T.mult[T.at.length - 1], 'under the first point / over the last: the end rows');

// 2. a river range, all combos (the board's removed), each size applied to a copy
const board = C.parseCards('Ks9d4h2c7s');
const shares = s => {
  const H = new RG.HandRanges(P.DEFAULTS); H.setPre(0, new Float32Array(C.NC).fill(1)); H.setPre(1, new Float32Array(C.NC).fill(1));
  H.startStreet(3, board); const before = H.bucketShares(0); H.apply(0, RG.betMult(um, s)); return { before, after: H.bucketShares(0), H };
};
const a = shares(0.33), b = shares(1.5);
const f = x => x.map(pct).join(' / ');
console.log('      the range before: ' + f(a.before) + '\n      after 33%: ' + f(a.after) + '\n      after 150%: ' + f(b.after));
check(b.after[1] + b.after[2] < a.after[1] + a.after[2], `150% leaves less B2+B3 than 33% (${pct(b.after[1] + b.after[2])} < ${pct(a.after[1] + a.after[2])})`);
check(b.after[0] > a.after[0] && b.after[4] > a.after[4], `150% leaves more B1 (${pct(b.after[0])} > ${pct(a.after[0])}) and more B5 (${pct(b.after[4])} > ${pct(a.after[4])})`);

// 3. the read's air against B / (P + 2B), at a typical river betting range (the bettor's range before its river bets in self-play,
//    tests/spec-theory.mjs 'range before', docs/decisions.md 2026-10-27)
const PRIOR = [0.29, 0.17, 0.18, 0, 0.36];
const airOf = (u, s) => { const m = RG.betMult(u, s), r = PRIOR.map((p, k) => p * m[k]), t = r.reduce((x, y) => x + y, 0); return r[4] / t; };
const ss = [0.33, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0], air = ss.map(s => airOf(um, s));
console.log('      the read\'s air by size: ' + ss.map((s, k) => `${Math.round(s * 100)}% ${pct(air[k])} (theory ${pct(s / (1 + 2 * s))})`).join(', '));
check(air.every((x, k) => k === 0 || x >= air[k - 1] - 1e-9) && air[air.length - 1] > air[0], 'the read\'s air rises with the size');
check(ss.every((s, k) => s < 0.75 || air[k] <= s / (1 + 2 * s)), 'at 75% or more, the read\'s air is not over the theory\'s share');

// 4. strategy.js: the others' view of the bot's bet, one per row
{
  const H = a.H0 || shares(0).H, prm = P.DEFAULTS;   // (size 0: the first row applied; only the range's support matters here)
  const ctx = { prm, H, seat: 0, Wme: H.W[0], Wop: H.W[1], P: 100, street: 3, stack: 10000, effStack: 10000, nOpp: 1, ip: true, toCall: 0 };
  ctx.swOp = H.table.sweep(ctx.Wme, false);
  const r1 = ST.reaction(ctx, 0.8), r2 = ST.reaction(ctx, 2.0);
  check(Object.keys(ctx.seen || {}).length === 2, `a bet of 80% and one of 200% are seen as two ranges (${Object.keys(ctx.seen || {}).length})`);
  check(r2.FE > r1.FE, `the others fold more to 200% than to 80% (${pct(r2.FE)} > ${pct(r1.FE)})`);
}

// 5. an older params set
{
  const o = Object.assign({}, um, { betSize: undefined, betSmall: [0.6, 1.0, 0.6, 0.7, 0.5], betBig: [1.0, 0.7, 0.1, 0.6, 0.4], bigBet: 0.75 });   // the rows before 2026-10-27
  check(RG.betMult(o, 0.5) === o.betSmall && RG.betMult(o, 0.75) === o.betBig && RG.betMult(o, 2.4) === o.betBig, 'no betSize: betSmall under bigBet, betBig at or over it');
}
console.log(fails ? `${fails} failed` : 'spec-betsize: all passed');
process.exitCode = fails ? 1 : 0;
