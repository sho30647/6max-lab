// Spec bot: ordinary draws are draws (B4), with the default parameters (docs/decisions.md 2026-10-27).
// Measured in play (flop, the bot's own hand against the opponent's range): a flush draw has D ~ 19% and E ~ 52%, an open-ended straight draw
// D ~ 17% and E ~ 44%, a gutshot D ~ 9%. With D >= 20%, E < 50% and the nut discount none of them was B4, so no hand was ever a semi-bluff.
// 1. the flush draw, the open-ended straight draw and the combo draw are B4 on the flop and the turn; their nuttiness does not take them out
// 2. a gutshot and a hand with no draw stay B5; a hand of 60% or more stays B2; the river has no B4
// Usage: node tests/spec-draws.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const ctx = street => ({ prm: P.DEFAULTS, street });
const b = (street, E, D, nutty) => ST.bucketOf(ctx(street), { E, D, V: 0, nutty });

// 1.
check(b(1, 0.52, 0.19, 0.3) === 4, 'flop flush draw (E 52%, D 19%, nuttiness 0.3): B4');
check(b(1, 0.44, 0.17, 0.05) === 4, 'flop open-ended straight draw (E 44%, D 17%, nuttiness 0.05): B4');
check(b(1, 0.56, 0.26, 0.2) === 4, 'flop combo draw (E 56%, D 26%): B4');
check(b(2, 0.40, 0.20, 0.3) === 4, 'turn flush draw (E 40%, D 20%): B4');
check(b(2, 0.35, 0.17, 0) === 4, 'turn open-ended straight draw (E 35%, D 17%): B4');
// 2.
check(b(1, 0.37, 0.09, 0.2) === 5, 'flop gutshot (E 37%, D 9%): B5');
check(b(1, 0.38, 0.02, null) === 5, 'flop no draw (E 38%, D 2%): B5');
check(b(1, 0.48, 0.05, null) === 3, 'flop marginal made hand (E 48%, D 5%): B3');
check(b(1, 0.62, 0.30, 0.5) === 2, 'flop 62% with a draw: B2 (value first)');
check(b(3, 0.40, 0.30, null) === 3 && b(3, 0.30, 0.30, null) === 5, 'river: no B4');

console.log(fails ? `${fails} FAIL` : 'spec-draws: all passed');
process.exitCode = fails ? 1 : 0;
