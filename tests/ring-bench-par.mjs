// Runs tests/ring-bench.mjs in parallel processes (different seeds) and pools the results.
// Usage: node tests/ring-bench-par.mjs <A> <B> [deals per process=1000] [processes=4] [first seed=1]
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ring-bench.mjs');
const [A = '4', B = '3', deals = '1000', procs = '4', seed0 = '1'] = process.argv.slice(2);
const runs = Array.from({ length: +procs }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [bench, A, B, deals, String(+seed0 + i)]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-400))); });
}));
const all = await Promise.all(runs);
let n = 0, m = 0, v = 0; all.forEach(x => { n += x.n; m += x.mean * x.n; v += (x.se * x.n) ** 2; });
m /= n; const se = Math.sqrt(v) / n;
console.log(`A=v${A} minus B=v${B}: bb/100 hands per player, ${n} duplicate deals (${2 * n} hands), seeds ${seed0}..${+seed0 + +procs - 1} (positive = A stronger)`);
console.log(`${m.toFixed(1)} ± ${(1.96 * se).toFixed(1)} (95%)${Math.abs(m) > 1.96 * se ? '  *' : ''}`);
