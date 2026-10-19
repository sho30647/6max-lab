// Self-play loop toward an equilibrium of the river knobs: from a starting version, try small one-knob deviations against it
// (half the table deviates, tests/ring-bench-par.mjs), adopt the best one if it wins beyond the 95% interval, repeat.
// It stops when no deviation wins: no tested change exploits the current version.
// Usage: node tests/ring-loop.mjs [start="6"] [rounds=6] [deals per process=2000]
import { execFileSync } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const par = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ring-bench-par.mjs');
const [start = '6+riverBluff=2+riverDefend=0', rounds = '6', deals = '2000'] = process.argv.slice(2);
const KNOBS = { riverBluff: { steps: [1, 2], min: 0, max: 5 }, riverDefend: { steps: [0.25, 0.5], min: 0, max: 1 } };   // small steps alone drown in the noise (+0.9 ± 0.9): try a big one too
const parse = s => { const [v, ...t] = s.split('+'); const o = {}; t.forEach(x => { const [k, y] = x.split('='); o[k] = +y; }); return { v, o }; };
const spec = c => c.v + Object.entries(c.o).map(([k, x]) => `+${k}=${+x.toFixed(2)}`).join('');
let cur = parse(start), seed = 1000;
for (let r = 1; r <= +rounds; r++) {
  const cands = [];
  for (const [k, { steps, min, max }] of Object.entries(KNOBS)) for (const d of steps.flatMap(x => [-x, x])) {
    const x = (cur.o[k] || 0) + d; if (x < min - 1e-9 || x > max + 1e-9) continue;
    cands.push({ v: cur.v, o: { ...cur.o, [k]: x } });
  }
  console.log(`round ${r}: current ${spec(cur)}`);
  let best = null;
  for (const c of cands) {
    const out = execFileSync('node', [par, spec(c), spec(cur), deals, '4', String(seed += 10)], { encoding: 'utf8' });
    const m = out.match(/^(-?[\d.]+) ± ([\d.]+)/m); const mean = +m[1], ci = +m[2];
    console.log(`  ${spec(c).padEnd(44)} vs current: ${mean.toFixed(1).padStart(6)} ± ${ci.toFixed(1)}${mean > ci ? '  *' : ''}`);
    if (mean > ci && (!best || mean > best.mean)) best = { c, mean, ci };
  }
  if (!best) { console.log(`no deviation wins: stop at ${spec(cur)}`); break; }
  cur = best.c; console.log(`  -> adopt ${spec(cur)} (+${best.mean.toFixed(1)})`);
}
console.log('FINAL ' + spec(cur));
