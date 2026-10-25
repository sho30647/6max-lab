// Spec bot against the old bot (v13): duplicate deals on the 6-max ring table (as tests/ring-bench.mjs: seats 0,2,4 = A and 1,3,5 = B, then swapped,
// the same cards and the same dice of the game in both plays; every hand starts at 100bb; neutral styles).
// Besides bb/100 (A = spec minus B = v13, per player, with its standard error), it splits the deals into those where the new bot made at least
// one postflop decision itself and those where it did not (no postflop decision, or only hand-overs to the old bot), and counts the decisions
// by node kind and the hand-overs by reason.
// Every deal of the table is played, so this is the measure for a change that acts before the flop too; for the postflop logic alone,
// tests/spec-duel.mjs (heads-up flops only) is the narrower one. All-ins before the river count at their EV (tests/spec-harness.mjs; --raw: as dealt).
// Usage: node tests/spec-eval.mjs [deals per process=500] [processes=4] [first seed=1] [--A=spec --B=13] [--precision=2] [--minutes=30] [--raw]
//          --precision=X: more batches until the 95% interval of the all-deals figure is +-X bb/100 or narrower; --minutes=M: stop after M minutes
//        (one process: node tests/spec-eval.mjs --worker <deals> <seed> <A> <B> <ev|raw>)
import { fileURLToPath } from 'url';
import { stat, options, worker, runBatches, verdict } from './eval-stats.mjs';
const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  const { openGame } = await import('./spec-harness.mjs');
  const N = +args[1], SEED = +args[2], A = args[3] || 'spec', B = args[4] || '13';
  const { browser, page, errors } = await openGame({ allinEV: args[5] !== 'raw' });
  const out = await page.evaluate(async ([N, SEED, A, B]) => {
    async function play(deal, vers, button) {
      S.players.forEach((p, i) => __setVer(p, vers[i]));
      S.resetStacks = true; S.button = button; Store.hands.length = 0; __seed(SEED * 7919 + deal * 13);
      const h0 = __hands.length;
      await playHand();
      const recs = __hands.slice(h0).flatMap(h => h.records);
      return { net: S.players.map(p => (p.stack - p.start) / BB), flop: S.board.length >= 3, spec: recs.filter(r => !r.other.fallback).length, legacy: recs.filter(r => r.other.fallback).length };
    }
    const rows = [];
    for (let k = 0; k < N; k++) {
      const btn = k % 6;
      const a = await play(k, [A, B, A, B, A, B], btn), b = await play(k, [B, A, B, A, B, A], btn);
      let sa = 0, sb = 0;
      for (let i = 0; i < 6; i++) { if (i % 2 === 0) { sa += a.net[i]; sb += b.net[i]; } else { sb += a.net[i]; sa += b.net[i]; } }
      rows.push({ d: (sa / 3 - sb / 3) * 100 / 2, flop: a.flop || b.flop, spec: a.spec + b.spec, legacy: a.legacy + b.legacy });
      if (__hands.length > 400) __hands.splice(0, __hands.length - 50);   // keep the memory small
    }
    return { rows, counts: SpecBot.counts, allin: __allinCount };
  }, [N, SEED, A, B]);
  console.log('RESULT ' + JSON.stringify({ rows: out.rows, counts: out.counts, allin: out.allin, errors: errors.slice(0, 3) }));
  await browser.close();
  process.exit(0);
}
const o = options(args);
const [deals = '500', procs = '4', seed0 = '1'] = o.pos;
const A = o.A || 'spec', B = o.B || '13', ev = o.raw ? 'raw' : 'ev';
const parts = [];
const { rows, minutes } = await runBatches({
  procs: +procs, seed0: +seed0, precision: +o.precision || 0, minutes: +o.minutes || 0, summary: stat,
  runBatch: async seeds => { const all = await Promise.all(seeds.map(s => worker(self, [deals, String(s), A, B, ev]))); parts.push(...all); return all.flatMap(x => x.rows); },
});
const tot = stat(rows), withSpec = stat(rows.filter(r => r.spec > 0)), without = stat(rows.filter(r => r.spec === 0)), flops = stat(rows.filter(r => r.flop));
const counts = { decisions: 0, spec: 0, legacy: {} };
for (const x of parts) { counts.decisions += x.counts.decisions; counts.spec += x.counts.spec || 0; for (const k in x.counts.legacy) counts.legacy[k] = (counts.legacy[k] || 0) + x.counts.legacy[k]; }
const f = x => `${x.mean.toFixed(1)} ± ${(1.96 * x.se).toFixed(1)} (95%, SE ${x.se.toFixed(1)})`;
console.log(`${A} minus ${B}, bb/100 hands per player, ${tot.n} duplicate deals (${2 * tot.n} hands), ${parts.length} processes from seed ${seed0}, ${minutes.toFixed(1)} min, all-ins ${ev === 'ev' ? 'at their EV' : 'as dealt'}`);
console.log(`all deals:  ${f(tot)}   <- the number to read`);
if (A === 'spec' || B === 'spec') {
  console.log(`  of which deals where the new bot decided postflop: ${f(withSpec)}  (${withSpec.n} deals; the others differ by exactly 0)`);
  console.log(`  deals where it did not (preflop only / old): ${f(without)}  (${without.n} deals)`);
  const leg = Object.values(counts.legacy).reduce((a, b) => a + b, 0);
  console.log(`postflop decisions of the new bot's seats: ${counts.decisions}; decided by the new bot ${counts.spec} (${(100 * counts.spec / counts.decisions).toFixed(1)}%), handed to the old bot ${leg} (${(100 * leg / counts.decisions).toFixed(1)}%): ${JSON.stringify(counts.legacy)}`);
} else console.log(`  of which deals that saw a flop: ${f(flops)}  (${flops.n} deals)`);
console.log(verdict(tot.mean, tot.se, A === 'spec' ? '新ボット' : 'A', B === '13' ? '旧ボット' : 'B'));
const errs = parts.flatMap(x => x.errors); if (errs.length) console.log('page errors:', errs);
console.log('RESULT ' + JSON.stringify({ tot, withSpec, without, counts, allin: parts.reduce((a, x) => a + x.allin, 0) }));
