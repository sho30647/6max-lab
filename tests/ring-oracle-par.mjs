// Runs tests/ring-oracle.mjs in parallel processes (different seeds) and pools the nodes.
// Usage: node tests/ring-oracle-par.mjs [ver=7] [hands per process=3000] [processes=4] [first seed=1] [table.json]
//   table.json missing: FIT run - pools the bet-size tables of the processes and writes them to table.json (the fitted estimator)
//   table.json present: EVAL run - the "FIT" rows are the fitted estimator (prior range x the table) against the true range
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ring-oracle.mjs');
import fs from 'fs';
const [VER = '7', N = '3000', P = '4', SEED0 = '1', TABLE = ''] = process.argv.slice(2), evalMode = TABLE && fs.existsSync(TABLE);
const runs = Array.from({ length: +P }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [bench, VER, N, String(+SEED0 + i), ...(evalMode ? [TABLE] : [])]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-400))); });
}));
const results = await Promise.all(runs), out = results.flatMap(r => r.rec), pooled = {};
for (const r of results) for (const c in r.bins) for (const cx in r.bins[c]) for (const b in r.bins[c][cx]) for (const d of [0, 1]) { const x = (((pooled[c] || (pooled[c] = {}))[cx] || (pooled[c][cx] = {}))[b] || (pooled[c][cx][b] = [[0, 0], [0, 0]]))[d], y = r.bins[c][cx][b][d]; x[0] += y[0]; x[1] += y[1]; }
if (TABLE && !evalMode) { fs.writeFileSync(TABLE, JSON.stringify(pooled)); console.log('wrote the fitted table to ' + TABLE); }
const stat = (rows, a, b) => { const v = rows.filter(r => isFinite(r[a]) && isFinite(r[b])), n = v.length; if (!n) return null; const d = v.map(r => r[b] - r[a]), bias = d.reduce((x, y) => x + y) / n, mae = d.reduce((x, y) => x + Math.abs(y), 0) / n, ma = v.reduce((x, r) => x + r[a], 0) / n, mb = v.reduce((x, r) => x + r[b], 0) / n; let c = 0, va = 0, vb = 0; for (const r of v) { c += (r[a] - ma) * (r[b] - mb); va += (r[a] - ma) ** 2; vb += (r[b] - mb) ** 2; } const sd = Math.sqrt(d.reduce((x, y) => x + (y - bias) ** 2, 0) / Math.max(1, n - 1)); return { n, true: ma, est: mb, bias, se: sd / Math.sqrt(n), mae, r: c / Math.sqrt(va * vb) }; };
const f2 = x => (x === null ? '-' : x.toFixed(2)).toString().padStart(6);
console.log(`ver ${VER}, ${+N * +P} hands (${P} x ${N}, seeds ${SEED0}..${+SEED0 + +P - 1}): flop, heads-up, the first bet; ${out.length} nodes`);
console.log('                              n   true    est    bias (+-se)    MAE   corr   (noise floor rows: the truth measured twice)');
for (const c of ['all', 'small', 'mid', 'big']) {
  const rows = c === 'all' ? out : out.filter(r => r.c === c);
  for (const [name, a, b] of [['range equity E', 'Et', 'Ee'], ['bluff share', 'Bt', 'Be'], ['  noise floor E', 'Et', 'Et2'], ['  noise floor bluff', 'Bt', 'Bt2'], ['FIT range equity E', 'Et', 'Ef'], ['FIT bluff share', 'Bt', 'Bf']]) { const s = stat(rows, a, b); if (s) console.log(`${(c + ' ' + name).padEnd(28)} ${String(s.n).padStart(5)} ${f2(s.true)} ${f2(s.est)} ${f2(s.bias)} (${s.se.toFixed(3)}) ${f2(s.mae)} ${f2(s.r)}`); }
}
console.log('RESULT ' + JSON.stringify({ n: out.length }));
