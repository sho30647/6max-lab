// Spec bot: a hand's class is its equity tier (B1 nuts / B2 value / B3 marginal / B5 air, by E alone) plus a draw flag (D), kept apart (owner's
// choice 2026-10-27, docs/decisions.md): a flush draw with 62% is "value, with a draw", not one or the other. The range update keeps §3's table:
// a draw in the marginal or air tier takes the draw column (B4), a draw in the nuts or value tier the column of its tier.
// Measured D in play (flop): a flush draw ~19%, an open-ended straight draw ~17% (14.9% with one dirty out), a gutshot ~9%, two overcards 12.8-13.0%.
// 1. the draw flag (J: next cards that take the hand to 80%+ AND raise it by 20pt+; a made hand that only creeps over 80% is no draw): flush draws, open-ended straight draws and combo draws have it at any equity; gutshots, two overcards and no draw do not; the river has none
// 2. the tier is the equity alone: 80 / 60 / 40%
// 3. the column of the range update (§3): a draw under 60% -> B4; at 60% or more -> its tier; no draw -> its tier
// Usage: node tests/spec-draws.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../bot/spec/equity.js'), ST = require('../bot/spec/strategy.js'), RG = require('../bot/spec/ranges.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const ctx = street => ({ prm: P.DEFAULTS, street });
const k = (street, E, J, nutty) => ST.bucketOf(ctx(street), { E, D: J, J, V: 0, nutty }) || {};   // J: the share of next cards that take it to 80%+ and up 20pt+
const same = (x, tier, draw) => x.tier === tier && x.draw === draw;

// 1. + 2.
check(same(k(1, 0.52, 0.19, 0.3), 3, true), 'flop flush draw, E 52%: marginal + draw');
check(same(k(1, 0.62, 0.19, 0.3), 2, true), 'flop flush draw with overcards, E 62%: value + draw');
check(same(k(1, 0.66, 0.26, 0.2), 2, true), 'flop combo draw, E 66%: value + draw');
check(same(k(1, 0.44, 0.17, 0.05), 3, true), 'flop open-ended straight draw, E 44%: marginal + draw');
check(same(k(1, 0.50, 7 / 47, 0), 3, true), 'flop open-ended straight draw with 7 clean cards of 47 (D 14.9%): a draw');
check(same(k(2, 0.35, 0.17, 0), 5, true), 'turn open-ended straight draw, E 35%: air + draw');
check(same(k(2, 0.30, 7 / 46, 0), 5, true), 'turn open-ended straight draw with 7 clean cards of 46: a draw');
check(same(k(1, 0.38, 6 / 47, 0.5), 5, false), 'flop two overcards (6 of 47, D 12.8%): air, no draw');
check(same(k(2, 0.30, 6 / 46, 0.5), 5, false), 'turn two overcards (6 of 46, D 13.0%): air, no draw');
check(same(k(1, 0.37, 0.09, 0.2), 5, false), 'flop gutshot (D 9%): air, no draw');
check(same(k(1, 0.48, 0.05, null), 3, false), 'flop marginal made hand: marginal, no draw');
check(same(k(3, 0.40, 0.30, null), 3, false) && same(k(3, 0.30, 0.30, null), 5, false), 'river: no draw');
check(same(k(1, 0.74, 0.02, null), 2, false), 'flop top pair, E 74%: many cards take it over 80% but few by 20pt: value, no draw');
check(same(k(1, 0.90, 0, null), 1, false), 'flop set, E 90%: nuts, no draw');
// 3.
check(k(1, 0.52, 0.19, 0.3).col === 4 && k(2, 0.35, 0.17, 0).col === 4, 'range update: a draw under 60% takes the draw column');
check(k(1, 0.62, 0.19, 0.3).col === 2 && k(1, 0.85, 0.40, null).col === 1, 'range update: a draw of 60% or more takes its tier');
check(k(1, 0.48, 0.05, null).col === 3 && k(1, 0.37, 0.09, 0.2).col === 5, 'range update: no draw takes its tier');
check(RG.bucketOf(0.52, 0.19, false, { b1: 0.8, b2: 0.6, b3: 0.4, drawMaxE: 0.6, devD: 0.14 }) === 4, 'ranges.bucketOf: the column, as before');
// 4. J from the next cards' equities (equity.js): a top pair at 74% that 20 cards take to 82% has D 20/47 but J 0; a flush draw at 50% that
//    9 cards take to 90% has J 9/47
const nx = (base, up, n) => { const a = new Float32Array(52).fill(NaN); for (let c = 0; c < 47; c++) a[c] = c < n ? up : base; return a; };
const tp = E.devVulOf(nx(0.74, 0.82, 20), 0.8, 0.5, 0.74, 0.2), fd = E.devVulOf(nx(0.40, 0.90, 9), 0.8, 0.5, 0.50, 0.2);
check(Math.abs(tp.D - 20 / 47) < 1e-9 && tp.J === 0, 'top pair: D counts the creep over 80%, J does not');
check(Math.abs(fd.J - 9 / 47) < 1e-9 && fd.J === fd.D, 'flush draw: J = D');

console.log(fails ? `${fails} FAIL` : 'spec-draws: all passed');
process.exitCode = fails ? 1 : 0;
