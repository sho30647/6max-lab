// Spec bot: a hand with no value reason bets when the bet beats the check on its whole EV (owner 2026-10-27, docs/decisions.md): what the bet
// takes when they fold, plus what the hand wins when called, by its equity to the river against the calling range. That equity already holds
// the gutshot, the backdoor draws and the overcards, as a solver counts them; no draw threshold decides whether a hand may bet.
// 1. a gutshot with overcards (E 33%, 35% against the callers, a fold share of 15%) has a reason to bet: the EV of the bet beats the check,
//    though the fold share alone does not pay for the bet (the old bluff test)
// 2. the same hand with 25% against the callers has none (the check is better)
// 3. on the river, air with some showdown value has no reason of its own when the check is worth as much as the bet: heads-up it is a
//    candidate of the river fill ('bluffFill': it bets only when strategy.js capBluffs puts it in up to the size's bluff cap, the owner's
//    decision 2026-10-28), with several opponents none
// 4. the label: a hand with the draw flag is a semi-bluff, any other a bluff
// Usage: node tests/spec-reasons.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const i = 0;
const ctx = (street, nOpp = 1) => ({ prm: P.DEFAULTS, street, ip: true, nOpp, P: 100 });
const react = (s, FE, Ec) => { const eq = new Float32Array(1326).fill(NaN); eq[i] = Ec; return { s, B: s * 100, FE, rho: 0, RT: 0, swC: { eq }, swR: null, callShare: 1 - FE, foldShare: FE, raiseShare: 0 }; };
const reason = (street, a, b, s, FE, Ec, nOpp) => ST.evalCombo(ctx(street, nOpp), i, a, b, [react(s, FE, Ec)]).bets[0].reason;

// 1.-2.
const gut = { E: 0.33, D: 0.085, J: 0.085, V: 0.8, nutty: 0.5 };
check(reason(1, gut, { tier: 5, draw: false }, 0.33, 0.15, 0.35) === 'bluff', 'flop gutshot with overcards: the bet beats the check (bluff, with its equity)');
check(reason(1, gut, { tier: 5, draw: false }, 0.33, 0.15, 0.25) === null, 'flop gutshot, 25% against the callers: no reason');
// 3.
check(reason(3, { E: 0.10, D: 0, J: 0, V: 0, nutty: null }, { tier: 5, draw: false }, 0.5, 0.40, 0) === 'bluffFill', 'river heads-up: the bluff only breaks even against the check: a fill candidate only');
check(reason(3, { E: 0.10, D: 0, J: 0, V: 0, nutty: null }, { tier: 5, draw: false }, 0.5, 0.40, 0, 2) === null, 'river multiway: the break-even bluff has no reason');
check(reason(3, { E: 0.60, D: 0, J: 0, V: 0, nutty: null }, { tier: 5, draw: false }, 0.5, 0.10, 0) === null, 'river heads-up: a bet far worse than the check is no candidate');
check(reason(2, { E: 0.10, D: 0, J: 0, V: 0, nutty: null }, { tier: 5, draw: false }, 0.5, 0.40, 0) !== 'bluffFill', 'turn: no fill candidate');
check(reason(3, { E: 0.02, D: 0, J: 0, V: 0, nutty: null }, { tier: 5, draw: false }, 0.5, 0.40, 0) === 'bluff', 'river air with no showdown value, fold share 40%: bluff');
// 4.
check(reason(1, { E: 0.45, D: 0.19, J: 0.19, V: 0.7, nutty: 0.6 }, { tier: 3, draw: true }, 0.33, 0.15, 0.45) === 'semibluff', 'flop flush draw: semibluff');

console.log(fails ? `${fails} FAIL` : 'spec-reasons: all passed');
process.exitCode = fails ? 1 : 0;
