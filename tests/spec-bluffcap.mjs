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
console.log(fails ? `${fails} FAIL` : 'spec-bluffcap: all passed');
process.exitCode = fails ? 1 : 0;
