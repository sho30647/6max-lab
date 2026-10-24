// Spec bot against the old bot (v13): duplicate deals on the 6-max ring table (as tests/ring-bench.mjs: seats 0,2,4 = A and 1,3,5 = B, then swapped,
// the same cards and the same dice of the game in both plays; every hand starts at 100bb; neutral styles).
// Besides bb/100 (A = spec minus B = v13, per player, with its standard error), it splits the deals into those where the new bot made at least
// one postflop decision itself and those where it did not (no postflop decision, or only hand-overs to the old bot), and counts the decisions
// by node kind and the hand-overs by reason.
// Usage: node tests/spec-eval.mjs [deals per process=500] [processes=4] [first seed=1]      (one process: node tests/spec-eval.mjs --worker <deals> <seed>)
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  const { openGame } = await import('./spec-harness.mjs');
  const N = +args[1], SEED = +args[2];
  const { browser, page, errors } = await openGame();
  const out = await page.evaluate(async ([N, SEED]) => {
    const A = 'spec', B = 13;
    async function play(deal, vers, button) {
      S.players.forEach((p, i) => { p.ver = vers[i]; p.tw = null; });
      S.resetStacks = true; S.button = button; Store.hands.length = 0; __seed(SEED * 7919 + deal * 13);
      const h0 = __hands.length;
      await playHand();
      const recs = __hands.slice(h0).flatMap(h => h.records);
      return { net: S.players.map(p => (p.stack - p.start) / BB), spec: recs.filter(r => !r.other.fallback).length, legacy: recs.filter(r => r.other.fallback).length };
    }
    const rows = [];
    for (let k = 0; k < N; k++) {
      const btn = k % 6;
      const a = await play(k, [A, B, A, B, A, B], btn), b = await play(k, [B, A, B, A, B, A], btn);
      let sa = 0, sb = 0;
      for (let i = 0; i < 6; i++) { if (i % 2 === 0) { sa += a.net[i]; sb += b.net[i]; } else { sb += a.net[i]; sa += b.net[i]; } }
      rows.push({ d: (sa / 3 - sb / 3) * 100 / 2, spec: a.spec + b.spec, legacy: a.legacy + b.legacy });
      if (__hands.length > 400) __hands.splice(0, __hands.length - 50);   // keep the memory small
    }
    const recs = __hands.flatMap(h => h.records);
    return { rows, counts: SpecBot.counts };
  }, [N, SEED]);
  console.log('RESULT ' + JSON.stringify({ rows: out.rows, counts: out.counts, errors: errors.slice(0, 3) }));
  await browser.close();
  process.exit(0);
}
const [deals = '500', procs = '4', seed0 = '1'] = args;
const t0 = Date.now();
const runs = Array.from({ length: +procs }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [self, '--worker', deals, String(+seed0 + i)]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-600))); });
}));
const all = await Promise.all(runs);
const rows = all.flatMap(x => x.rows);
const stat = rs => { const n = rs.length; if (!n) return { n, mean: 0, se: 0 }; const m = rs.reduce((a, r) => a + r.d, 0) / n; const sd = Math.sqrt(rs.reduce((a, r) => a + (r.d - m) ** 2, 0) / Math.max(1, n - 1)); return { n, mean: m, se: sd / Math.sqrt(n) }; };
const tot = stat(rows), withSpec = stat(rows.filter(r => r.spec > 0)), without = stat(rows.filter(r => r.spec === 0));
const counts = { decisions: 0, spec: 0, legacy: {}, kinds: {} };
for (const x of all) { counts.decisions += x.counts.decisions; counts.spec += x.counts.spec || 0; for (const k in x.counts.legacy) counts.legacy[k] = (counts.legacy[k] || 0) + x.counts.legacy[k]; }
const f = x => `${x.mean.toFixed(1)} ± ${(1.96 * x.se).toFixed(1)} (95%, SE ${x.se.toFixed(1)})`;
console.log(`spec minus v13, bb/100 hands per player, ${tot.n} duplicate deals (${2 * tot.n} hands), seeds ${seed0}..${+seed0 + +procs - 1}, ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(`POSTFLOP hands (the new bot decided postflop): ${f(withSpec)}  (${withSpec.n} deals)   <- the number to read: the postflop logic's difference`);
console.log(`all deals (the others differ by exactly 0):  ${f(tot)}   (the same difference, diluted by the hands that never reach a new-bot decision)`);
console.log(`deals where it did not (preflop only / old): ${f(without)}  (${without.n} deals)`);
const leg = Object.values(counts.legacy).reduce((a, b) => a + b, 0);
console.log(`postflop decisions of the new bot's seats: ${counts.decisions}; decided by the new bot ${counts.spec} (${(100 * counts.spec / counts.decisions).toFixed(1)}%), handed to the old bot ${leg} (${(100 * leg / counts.decisions).toFixed(1)}%): ${JSON.stringify(counts.legacy)}`);
const errs = all.flatMap(x => x.errors); if (errs.length) console.log('page errors:', errs);
console.log('RESULT ' + JSON.stringify({ tot, withSpec, without, counts }));
