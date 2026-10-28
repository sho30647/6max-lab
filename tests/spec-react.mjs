// Spec bot, §8 step 2 against §9 B: the measure of the bot's estimate of the others' fold share (docs/decisions.md 2026-10-28).
// tests/spec-theory.mjs splits the gap between the estimate (strategy.js reaction: "E over B / (P + 2B) + marginReact calls") and the real
// answers into the rule's part and the range read's part with strategy.js recvFold: the fold share if each of the others' combos answered by
// the bot's own facing() rule. That split is only right if recvFold is what facing() does, combo by combo. Checked here on a river and a turn:
//   1. recvFold at a bet of s = the weight of the others' combos for which facing() folds, after the bet is read with §3's row of s (as index.js does)
//   2. recvFold is computed only in the measurement mode (ctx.diag); the trace keeps the estimate per size (perSize[].FE)
//   3. the estimate (no MDF guard, + marginReact) folds more than the own rule at a small river bet where the guard is on
// Before 2026-10-28 there was no recvFold and perSize had no FE: every check failed.
// Usage: node tests/spec-react.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js'), RG = require('../bot/spec/ranges.js'), ST = require('../bot/spec/strategy.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const pct = x => (100 * x).toFixed(1) + '%';
if (typeof ST.recvFold !== 'function') { console.log('FAIL strategy.js has no recvFold'); process.exit(1); }
const prm = P.DEFAULTS, NC = C.NC;

// two ranges on a board: the bettor (seat 0) a wide range, the other (seat 1) its calling range so far (pairs and broadways, a few weak hands)
function spot(boardStr, street) {
  const H = new RG.HandRanges(prm), A = new Float32Array(NC), Bw = new Float32Array(NC);
  for (let i = 0; i < NC; i++) { const r1 = C.CA[i] >> 2, r2 = C.CB[i] >> 2; A[i] = 1; Bw[i] = r1 === r2 || Math.min(r1, r2) >= 8 ? 1 : 0.25; }
  H.setPre(0, A); H.setPre(1, Bw); H.startStreet(street, C.parseCards(boardStr)); return H;
}
// facing() for every combo of seat 1 after seat 0 bets s x P0; the fold weight share
function facingFold(boardStr, street, s, P0, eff, bettorIP) {
  const H = spot(boardStr, street);
  H.apply(0, RG.betMult(prm.equilibrium.updateMult, s));   // the bet, read by its size (index.js onAction)
  const B = s * P0, Wme = H.W[1], Wop = H.others(1);
  const base = { prm, H, seat: 1, street, board: C.parseCards(boardStr), Wme, Wop, P: P0 + B, toCall: B, stack: eff, myBet: 0, currentBet: B, effStack: eff, ip: !bettorIP, nOpp: 1, rng: () => 1, bb: 100 };
  base.swMe = H.table.sweep(Wop, street < 3); base.swOp = H.table.sweep(Wme, false);
  let t = 0, f = 0;
  for (let i = 0; i < NC; i++) {
    if (!(Wme[i] > 0) || !(base.swMe.eq[i] >= 0)) continue;
    const ctx = Object.assign({}, base, { own: i, hole: [C.CA[i], C.CB[i]], tr: {} });
    const r = ST.facing(ctx); t += Wme[i]; if (r.act === 'fold') f += Wme[i];
  }
  return f / t;
}
function estimate(boardStr, street, s, P0, eff, bettorIP, diag) {
  const H = spot(boardStr, street);
  const ctx = { prm, H, seat: 0, street, Wme: H.W[0], Wop: H.others(0), P: P0, toCall: 0, stack: eff, effStack: eff, ip: bettorIP, nOpp: 1, diag };
  ctx.swOp = H.table.sweep(ctx.Wme, false);
  return ST.reaction(ctx, s);
}

// 1.
for (const [board, street, s, P0, eff, ip] of [['Ks9d4h2c7s', 3, 0.75, 1000, 6000, true], ['Ks9d4h2c7s', 3, 1.25, 1000, 6000, false], ['Ks9d4h2c7s', 3, 0.33, 1000, 6000, true], ['Jh8h3c2d', 2, 0.75, 600, 4000, true], ['Jh8h3c2d', 2, 1.25, 600, 900, false]]) {
  const want = facingFold(board, street, s, P0, eff, ip), got = estimate(board, street, s, P0, eff, ip, true).recvFold;
  check(Math.abs(got - want) < 0.005, `${board} ${street === 3 ? 'river' : 'turn'}, a bet of ${Math.round(s * 100)}% (stack ${eff / P0}x pot): recvFold ${pct(got)} = facing() folds ${pct(want)}`);
}
// 2.
{
  const r = estimate('Ks9d4h2c7s', 3, 0.75, 1000, 6000, true, false);
  check(r.recvFold === undefined, 'outside the measurement mode recvFold is not computed');
}
// 3.
{
  const r = estimate('Ks9d4h2c7s', 3, 0.75, 1000, 6000, true, true);
  console.log(`      river 75%: the estimate ${pct(r.FE)}, by the own rule ${pct(r.recvFold)}, B / (P + B) ${pct(0.75 / 1.75)}`);
  check(r.FE > r.recvFold, 'the estimate (no MDF guard, + marginReact) folds more than the own rule');
}
console.log(fails ? `${fails} failed` : 'spec-react: all passed');
process.exitCode = fails ? 1 : 0;
