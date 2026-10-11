// Runs tests/mtt-bench.mjs in parallel processes (different seeds) and pools the results.
// Usage: node tests/mtt-bench-par.mjs <A> <B> [depths=8,12] [deals per process=500] [processes=4]
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'mtt-bench.mjs');
const [A = 'base', B = 'old', depths = '8,12', deals = '500', procs = '4'] = process.argv.slice(2);
const runs = Array.from({ length: +procs }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [bench, A, B, depths, deals, String(101 + i)]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-400))); });
}));
const all = await Promise.all(runs);
console.log(`A=${A} minus B=${B}: bb/100 hands per player, pooled over ${procs} x ${deals} duplicate deals (positive = A stronger)`);
for (const d of depths.split(',')) {
  let n = 0, m = 0, v = 0; all.forEach(r => { const x = r[d]; n += x.n; m += x.mean * x.n; v += (x.se * x.n) ** 2; });
  m /= n; const se = Math.sqrt(v) / n;
  console.log(`${String(d).padStart(3)}bb  ${m.toFixed(1).padStart(7)} ± ${(1.96 * se).toFixed(1)} (95%)  deals ${n}${Math.abs(m) > 1.96 * se ? '  *' : ''}`);
}
