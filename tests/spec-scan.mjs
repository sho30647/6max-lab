// The night scan (.claude/skills/night-review/SKILL.md): where the new bot loses chips, found by playing, not by reading its own numbers.
// The new bot plays itself from the flop (the heads-up lines of tests/spec-duel.mjs). Each of its decisions is then played again with the other
// action (facing a bet: fold <-> call, a raise -> call; first to act: check <-> a bet of 2/3 of the pot), with the same cards and the same dice up to
// that decision, so the difference of the two results (other minus actual, bb, all-ins at their EV) is what that one action changed.
// One hand's difference is mostly the luck of the opponent's cards; the decisions are grouped (street, node, action, the bot's bucket, the size)
// and a group whose average difference is above 0 beyond its 99% interval (99, not 95: about a hundred groups are tested at once) is a spot where the other action would have won more against this
// opponent. That is a candidate, not a verdict: the opponent is the bot itself, so it can also be the opponent's leak that makes the other action pay.
// bot-judge decides from poker theory (two sample hands of each group, without the opponent's cards, are in the output for him).
// Usage: node tests/spec-scan.mjs [--minutes=60] [--procs=4] [--seed=1] [--deals=40 per worker run] [--top=3] [--out=file.json] [--A=spec] [--B=spec]
import { fileURLToPath } from 'url'; import path from 'path'; import fs from 'fs';
import { stat, options, worker } from './eval-stats.mjs';
import { LINES } from './spec-duel.mjs';
const duel = path.join(path.dirname(fileURLToPath(import.meta.url)), 'spec-duel.mjs');
const o = options(process.argv.slice(2));
const MIN = +(o.minutes || 60), PROCS = +(o.procs || 4), SEED0 = +(o.seed || 1), DEALS = +(o.deals || 40), TOP = +(o.top || 3);
const VA = o.A || 'spec', VB = o.B || 'spec', LW = JSON.stringify(LINES);
const t0 = Date.now(), rows = []; let seed = SEED0, deals = 0, bad = 0;
while ((Date.now() - t0) / 60000 < MIN) {
  const seeds = Array.from({ length: PROCS }, () => seed++);
  const all = await Promise.all(seeds.map(s => worker(duel, [String(DEALS), String(s), LW, 'a', VA, VB, 'ev', 'scan']).then(r => r.rows.map(x => Object.assign(x, { seed: s })))));
  for (const r of all.flat()) { if (r.same) rows.push(r); else bad++; }
  deals += DEALS * PROCS;
  console.log(`  … ${deals} deals, ${rows.length} decisions played again, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
// the groups
const ST = ['', 'flop', 'turn', 'river'];
const band = x => x == null ? '-' : x < 0.4 ? '<0.4' : x < 0.8 ? '0.4-0.8' : x < 1.3 ? '0.8-1.3' : '1.3+';
const keyOf = r => [ST[r.st], r.nk, `${r.act}->${r.alt}`, 'B' + r.b, r.act === 'check' ? '-' : band(r.size)].join(' | ');
const groups = new Map();
for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
const flops = deals * (VA === VB ? 1 : 2);
const G = [...groups].map(([key, rs]) => { const s = stat(rs); return { key, n: rs.length, mean: s.mean, se: s.se, lo: s.mean - 2.58 * s.se,
  per100: 100 * s.mean * rs.length / flops,   // bb per 100 flops that the other action would have added (the weight of the group in the bot's play)
  E: rs.reduce((a, x) => a + (x.E || 0), 0) / rs.length, need: rs.some(x => x.need != null) ? rs.reduce((a, x) => a + (x.need || 0), 0) / rs.filter(x => x.need != null).length : null,
  spr: rs.reduce((a, x) => a + x.spr, 0) / rs.length, guard: rs.filter(x => x.guard).length / rs.length, rs }; });
const sig = G.filter(g => g.n >= 60 && g.lo > 0).sort((a, b) => b.per100 - a.per100);
const top = sig.slice(0, TOP);
// two sample hands per top group: those whose difference is nearest the group's mean (not the luckiest ones)
const want = top.flatMap((g, gi) => g.rs.slice().sort((a, b) => Math.abs(a.d - g.mean) - Math.abs(b.d - g.mean)).slice(0, 2).map(r => ({ gi, seed: r.seed, k: r.k, play: r.play, j: r.j, d: r.d })));
const bySeed = {}; for (const w of want) (bySeed[w.seed] = bySeed[w.seed] || []).push(w);
const details = (await Promise.all(Object.entries(bySeed).map(([s, ws]) => worker(duel, [String(Math.max(...ws.map(w => w.k)) + 1), s, LW, 'a', VA, VB, 'ev', 'detail', JSON.stringify(ws.map(w => ({ k: w.k, play: w.play, j: w.j })))])
  .then(r => r.rows.map(x => Object.assign(x, { seed: +s })))))).flat();
const f = x => (x >= 0 ? '+' : '') + x.toFixed(2);
// the sample hand must be the decision of the group (the detail run plays the same deal with the same dice)
const actOf = x => x.botAction.act === 'raise' ? (x.facing.toCallBB ? 'raise' : 'bet') : x.botAction.act === 'call' && !x.facing.toCallBB ? 'check' : x.botAction.act;
const off = details.filter(x => { const w = want.find(w => w.seed === x.seed && w.k === x.key.k && w.play === x.key.play && w.j === x.key.j); return !top[w.gi].key.includes(` ${actOf(x)}->`); });
if (off.length) { console.log(`FAIL ${off.length} sample hands do not show the group's action (the detail run was not the same play)`); process.exitCode = 1; }
console.log(`\n${VA} against ${VB}: ${deals} deals, ${rows.length} decisions played again with the other action (${bad} left out: the play again was not the same before the decision), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log(`groups with 60+ decisions where the other action won more (99%): ${sig.length} of ${G.filter(g => g.n >= 60).length}`);
for (const g of sig.slice(0, 10)) console.log(`  ${g.key.padEnd(46)} n=${String(g.n).padStart(5)}  other - actual ${f(g.mean)} bb (99%: ${f(g.lo)} ..)  ${f(g.per100)} bb/100 flops  E ${(100 * g.E).toFixed(0)}%` + (g.need != null ? ` need ${(100 * g.need).toFixed(0)}%` : '') + `  SPR ${g.spr.toFixed(1)}`);
const out = { at: new Date().toISOString(), A: VA, B: VB, deals, decisions: rows.length, left: bad, minutes: (Date.now() - t0) / 60000,
  top: top.map((g, gi) => ({ key: g.key, n: g.n, mean: g.mean, lo: g.lo, per100: g.per100, E: g.E, need: g.need, spr: g.spr, mdfGuardShare: g.guard,
    hands: details.filter(x => want.some(w => w.gi === gi && w.seed === x.seed && w.k === x.key.k && w.play === x.key.play && w.j === x.key.j)).map(x => Object.assign(x, { d: want.find(w => w.seed === x.seed && w.k === x.key.k && w.play === x.key.play && w.j === x.key.j).d })) })),
  groups: G.filter(g => g.n >= 60).map(({ rs, ...g }) => g).sort((a, b) => b.per100 - a.per100) };
if (o.out) { fs.writeFileSync(o.out, JSON.stringify(out, null, 1)); console.log('written', o.out); }
console.log('RESULT ' + JSON.stringify({ deals, decisions: rows.length, left: bad, top: out.top.map(g => ({ key: g.key, n: g.n, mean: g.mean, per100: g.per100, hands: g.hands.length })) }));
