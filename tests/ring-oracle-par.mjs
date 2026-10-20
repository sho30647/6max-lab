// Runs tests/ring-oracle.mjs in parallel processes (different seeds) and pools the nodes.
// Usage: node tests/ring-oracle-par.mjs [ver=7] [hands per process=3000] [processes=4] [first seed=1]
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ring-oracle.mjs');
const [VER = '7', N = '3000', P = '4', SEED0 = '1'] = process.argv.slice(2);
const runs = Array.from({ length: +P }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [bench, VER, N, String(+SEED0 + i)]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-400))); });
}));
const out = (await Promise.all(runs)).flat();
const stat = (rows, a, b) => { const v = rows.filter(r => isFinite(r[a]) && isFinite(r[b])), n = v.length; if (!n) return null; const d = v.map(r => r[b] - r[a]), bias = d.reduce((x, y) => x + y) / n, mae = d.reduce((x, y) => x + Math.abs(y), 0) / n, ma = v.reduce((x, r) => x + r[a], 0) / n, mb = v.reduce((x, r) => x + r[b], 0) / n; let c = 0, va = 0, vb = 0; for (const r of v) { c += (r[a] - ma) * (r[b] - mb); va += (r[a] - ma) ** 2; vb += (r[b] - mb) ** 2; } const sd = Math.sqrt(d.reduce((x, y) => x + (y - bias) ** 2, 0) / Math.max(1, n - 1)); return { n, true: ma, est: mb, bias, se: sd / Math.sqrt(n), mae, r: c / Math.sqrt(va * vb) }; };
const f2 = x => (x === null ? '-' : x.toFixed(2)).toString().padStart(6);
console.log(`ver ${VER}, ${+N * +P} hands (${P} x ${N}, seeds ${SEED0}..${+SEED0 + +P - 1}): flop, heads-up, the first bet; ${out.length} nodes`);
console.log('                              n   true    est    bias (+-se)    MAE   corr   (noise floor rows: the truth measured twice)');
for (const c of ['all', 'small', 'mid', 'big']) {
  const rows = c === 'all' ? out : out.filter(r => r.c === c);
  for (const [name, a, b] of [['range equity E', 'Et', 'Ee'], ['bluff share', 'Bt', 'Be'], ['  noise floor E', 'Et', 'Et2'], ['  noise floor bluff', 'Bt', 'Bt2']]) { const s = stat(rows, a, b); if (s) console.log(`${(c + ' ' + name).padEnd(26)} ${String(s.n).padStart(5)} ${f2(s.true)} ${f2(s.est)} ${f2(s.bias)} (${s.se.toFixed(3)}) ${f2(s.mae)} ${f2(s.r)}`); }
}
console.log('RESULT ' + JSON.stringify(out));
