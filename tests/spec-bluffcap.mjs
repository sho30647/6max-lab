// Spec bot, §8's bluff cap per size (strategy.js capBluffs, docs/decisions.md 2026-10-27): the bluffs cut at one size's cap go to the other
// size when that bet also beats the check and has room under its own cap; only what is left checks.
// Before: every bluff cut at a size went to the check. On the river the bluffs mostly liked the bigger size (more folds) while the value bet
// the other, so the size with the value had room for bluffs and held none (the river's big bets: 28% bluffs against B / (P + 2B) = 39%).
// 1. two sizes, the value at size 1, every bluff prefers size 2 (no value there): the bluffs fill size 1 up to its cap, the rest checks
// 2. a bluff whose size-1 bet does not beat the check (no reason, or EV under the check) stays checked
// 3. the cap still holds at every size, and the bluffs with the better blockers are kept first
// 4. no cut, no change (one size, or bluffs under the cap)
// 5. what counts: a bet whose reason at that size is 'bluff' (evalCombo). On the river that is every bet that is not value, so a marginal hand
//    (B3) that bets behind the callers takes room under the cap too (before: only the air, B5, was counted)
// 6. the river fill (the owner's decision 2026-10-28, docs/decisions.md, §8): heads-up on the river, a bluff whose bet is within tau (2% of
//    the pot) of the check, below it too ('bluffFill'), is not mixed 0.5 + 0.5 x delta / tau but put in until the size's bluff share reaches
//    B / (P + 2B): the smallest loss first, then the better blocker. -3% of the pot stays checked; several opponents: no fill; the cap holds
// Usage: node tests/spec-bluffcap.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ST = require('../bot/spec/strategy.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
if (typeof ST.capBluffs !== 'function') { console.log('FAIL strategy.js has no capBluffs'); process.exit(1); }
// a combo: weight w, bucket b, its probabilities [check, size 1, size 2], and the EVs (check, size 1, size 2) with a reason or not
const combo = (id, w, b, p, evCheck, ev1, ev2, r1 = 'bluff', r2 = 'bluff') => ({ id, w, b, draw: false, p: p.slice(), ev: { evCheck, bets: [{ EV: ev1, reason: r1 }, { EV: ev2, reason: r2 }] } });
const share = (cs, k) => { let bw = 0, bl = 0; for (const c of cs) { const x = c.w * c.p[k]; bw += x; if (c.ev.bets[k - 1].reason === 'bluff') bl += x; } return bw ? bl / bw : 0; };
const caps = [1 / 3, 0.375];   // river: 100% and 150% of the pot

// 1.
{
  const V = combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value');
  const A = combo('a', 1, 5, [0, 0, 1], 0, 3, 4), Bb = combo('b', 1, 5, [0, 0, 1], 0, 2, 4);
  const cs = [V, A, Bb];
  ST.capBluffs(cs, caps, c => ({ a: 2, b: 1 })[c.id] || 0, 0);
  // size 2 holds no value: no bluffs there. Size 1: room 0.5 x the value weight 1 = 0.5, given to the better blocker (a) first
  check(near(A.p[2], 0) && near(Bb.p[2], 0), 'size 2 has no value: no bluffs left there');
  check(near(A.p[1], 0.5) && near(A.p[0], 0.5), `bluff a: half to size 1 (room), half checks; got ${A.p.map(x => x.toFixed(3))}`);
  check(near(Bb.p[1], 0) && near(Bb.p[0], 1), `bluff b (worse blocker): checks; got ${Bb.p.map(x => x.toFixed(3))}`);
  check(near(share(cs, 1), 1 / 3), `size 1 bluff share = its cap 1/3; got ${share(cs, 1).toFixed(3)}`);
  for (const c of cs) check(near(c.p.reduce((a, x) => a + x, 0), 1), `probabilities of ${c.id} sum to 1`);
}
// 2.
{
  const V = combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value');
  const A = combo('a', 1, 5, [0, 0, 1], 3, 2, 4);              // size 1's bet is worse than the check
  const Bb = combo('b', 1, 5, [0, 0, 1], 0, 3, 4, null, 'bluff');   // size 1: no reason
  const cs = [V, A, Bb];
  ST.capBluffs(cs, caps, () => 0, 0);
  check(near(A.p[0], 1) && near(Bb.p[0], 1), 'bluffs whose other size does not beat the check stay checked');
  // the frequency shift delta counts: with delta 2 the size-1 bet of a (2 + 2 > 3) beats the check
  const A2 = combo('a', 1, 5, [0, 0, 1], 3, 2, 4), cs2 = [combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value'), A2];
  ST.capBluffs(cs2, caps, () => 0, 2);
  check(near(A2.p[1], 0.5), `with the shift delta the bet beats the check: moves; got ${A2.p.map(x => x.toFixed(3))}`);
}
// 3.
{
  const V1 = combo('v1', 2, 1, [0, 1, 0], 5, 20, 18, 'value', 'value'), V2 = combo('v2', 1, 2, [0, 0, 1], 5, 10, 12, 'value', 'value');
  const bl = Array.from({ length: 6 }, (_, k) => combo('x' + k, 1, 5, [0, 0.2, 0.8], 0, 3, 4));
  const cs = [V1, V2, ...bl];
  ST.capBluffs(cs, caps, c => c.id === 'x0' ? 9 : c.id === 'x1' ? 8 : 0, 0);
  check(share(cs, 1) <= caps[0] + 1e-9 && share(cs, 2) <= caps[1] + 1e-9, `caps hold: ${share(cs, 1).toFixed(3)} / ${share(cs, 2).toFixed(3)}`);
  check(near(share(cs, 1), caps[0]) && near(share(cs, 2), caps[1]), 'both sizes are filled to their caps (enough bluffs)');
  const x0 = bl[0], x5 = bl[5];
  check(x0.p[0] < x5.p[0] - 0.1, `the better blocker checks less (x0 checks ${x0.p[0].toFixed(3)}, x5 ${x5.p[0].toFixed(3)})`);
}
// 4.
{
  const V = combo('v', 3, 1, [0, 1, 0], 5, 20, 18, 'value', 'value'), A = combo('a', 1, 5, [0, 1, 0], 0, 3, 2);
  const cs = [V, A]; ST.capBluffs(cs, caps, () => 0, 0);
  check(near(A.p[1], 1) && near(A.p[0], 0), 'under the cap: unchanged');
  const W = combo('w', 1, 1, [0, 1], 5, 20, 0, 'value'), Z = combo('z', 1, 5, [0, 1], 0, 3, 0); W.ev.bets.pop(); Z.ev.bets.pop();
  ST.capBluffs([W, Z], [0.25], () => 0, 0);
  check(near(Z.p[1], 1 / 3) && near(Z.p[0], 2 / 3), `one size: the cut checks, as before; got ${Z.p.map(x => x.toFixed(3))}`);
  // flop / turn cap of 1 (twice B / (P + 2B), clamped): no cut
  const F = combo('f', 1, 5, [0, 1, 0], 0, 3, 2); ST.capBluffs([F], [1, 1], () => 0, 0);
  check(near(F.p[1], 1), 'a cap of 1 never cuts');
}
// 5.
{
  const V = combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value');
  const M = combo('m', 1, 3, [0, 1, 0], 4, 6, 5);        // river B3 betting with no value reason: a bluff
  const A = combo('a', 1, 5, [0, 1, 0], 0, 3, 2);
  const cs = [V, M, A];
  ST.capBluffs(cs, [1 / 3, 0.375], c => c.id === 'm' ? 1 : 0, 0);
  check(near(share(cs, 1), 1 / 3), `the B3 bluff counts: size 1 at its cap; got ${share(cs, 1).toFixed(3)}`);
  check(near(M.p[1], 0.5) && near(A.p[1], 0), `room 0.5 to the better blocker (the B3), the air checks; got m ${M.p.map(x => x.toFixed(3))} a ${A.p.map(x => x.toFixed(3))}`);
}
// 6.
{
  const P = 100, fill = (nOpp = 1, street = 3) => ({ street, nOpp, tau: 0.02 * P });
  const bShare = (cs, k) => { let bw = 0, bl = 0; for (const c of cs) { const x = c.w * c.p[k]; bw += x; if (c.ev.bets[k - 1].reason === 'bluff' || c.ev.bets[k - 1].reason === 'bluffFill') bl += x; } return bw ? bl / bw : 0; };
  // the value at size 1 (room 0.5 there), the air's size-1 bet 1% of the pot under the check: fills size 1 to its cap
  const mk = () => [combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value'), combo('a', 1, 5, [1, 0, 0], 0, -1, -1.5, 'bluffFill', 'bluffFill')];
  let cs = mk(); ST.capBluffs(cs, caps, () => 0, 0, fill());
  check(near(cs[1].p[1], 0.5) && near(cs[1].p[0], 0.5), `river, -1%P: fills size 1 up to its cap; got ${cs[1].p.map(x => x.toFixed(3))}`);
  check(near(bShare(cs, 1), caps[0]), `river, -1%P: size 1 at its cap 1/3; got ${bShare(cs, 1).toFixed(3)}`);
  // -3% of the pot: outside tau, stays checked
  cs = [combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value'), combo('a', 1, 5, [1, 0, 0], 0, -3, -3.5, 'bluffFill', 'bluffFill')];
  ST.capBluffs(cs, caps, () => 0, 0, fill());
  check(near(cs[1].p[0], 1), `river, -3%P: stays checked; got ${cs[1].p.map(x => x.toFixed(3))}`);
  // several opponents, or the turn: no fill
  cs = mk(); ST.capBluffs(cs, caps, () => 0, 0, fill(2));
  check(near(cs[1].p[0], 1), `multiway river: no fill; got ${cs[1].p.map(x => x.toFixed(3))}`);
  cs = mk(); ST.capBluffs(cs, caps, () => 0, 0, fill(1, 2));
  check(near(cs[1].p[0], 1), `turn: no fill; got ${cs[1].p.map(x => x.toFixed(3))}`);
  // the cap holds with many candidates; the smallest loss first (a mixed bluff above the check before those below it), then the better blocker
  const V = combo('v', 3, 1, [0, 1, 0], 5, 20, 18, 'value', 'value');                 // a cap of 1.5 at size 1, 0.75 left
  const M = combo('m', 1, 5, [0.25, 0.75, 0], 0, 1, -5, 'bluff', null);               // +1%P: mixed 75% by the old rule
  const X = combo('x', 1, 5, [1, 0, 0], 0, -0.5, -5, 'bluffFill', null);              // -0.5%P
  const Y1 = combo('y1', 1, 5, [1, 0, 0], 0, -1.5, -5, 'bluffFill', null), Y2 = combo('y2', 1, 5, [1, 0, 0], 0, -1.5, -5, 'bluffFill', null);
  cs = [V, M, X, Y1, Y2]; ST.capBluffs(cs, caps, c => c.id === 'y2' ? 5 : 0, 0, fill());
  check(bShare(cs, 1) <= caps[0] + 1e-9 && near(bShare(cs, 1), caps[0]), `the cap holds and is reached; got ${bShare(cs, 1).toFixed(3)}`);
  check(near(M.p[1], 1), `+1%P bluff: put in fully, not mixed; got ${M.p.map(x => x.toFixed(3))}`);
  check(near(X.p[1], 0.5), `-0.5%P before -1.5%P: x gets the room left (0.5); got ${X.p.map(x => x.toFixed(3))}`);
  check(near(Y1.p[1], 0) && near(Y2.p[1], 0), `-1.5%P: no room left; got y1 ${Y1.p[1].toFixed(3)} y2 ${Y2.p[1].toFixed(3)}`);
  // the same loss: the better blocker first
  const V2 = combo('v', 1, 1, [0, 1, 0], 5, 20, 18, 'value', 'value');
  const Z1 = combo('z1', 1, 5, [1, 0, 0], 0, -1, -5, 'bluffFill', null), Z2 = combo('z2', 1, 5, [1, 0, 0], 0, -1, -5, 'bluffFill', null);
  cs = [V2, Z1, Z2]; ST.capBluffs(cs, caps, c => c.id === 'z2' ? 5 : 0, 0, fill());
  check(near(Z2.p[1], 0.5) && near(Z1.p[1], 0), `same loss: the better blocker (z2) first; got z1 ${Z1.p[1].toFixed(3)} z2 ${Z2.p[1].toFixed(3)}`);
  for (const c of [V, M, X, Y1, Y2, V2, Z1, Z2]) check(near(c.p.reduce((a, x) => a + x, 0), 1), `probabilities of ${c.id} sum to 1`);
}
console.log(fails ? `${fails} FAIL` : 'spec-bluffcap: all passed');
process.exitCode = fails ? 1 : 0;
