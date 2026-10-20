// Runs tests/ring-spots.mjs in parallel processes (different seeds) and pools the counts, then prints the same tables.
// Usage: node tests/ring-spots-par.mjs [ver=7] [hands per process=5000] [processes=4] [first seed=1]
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const bench = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'ring-spots.mjs');
const [VER = '7', N = '5000', P = '4', SEED0 = '1'] = process.argv.slice(2);
const runs = Array.from({ length: +P }, (_, i) => new Promise((res, rej) => {
  const c = spawn('node', [bench, VER, N, String(+SEED0 + i)]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
  c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-400))); });
}));
const all = await Promise.all(runs), st = {}, pairs = {};
for (const r of all) for (const [k, x] of Object.entries(r)) {
  if (k === '__pairs') { for (const s in x) (pairs[s] || (pairs[s] = [])).push(...x[s]); continue; }
  const y = st[k] || (st[k] = { n: 0, fold: 0, call: 0, raise: 0, evFold: 0, evCall: 0, evAll: 0, bluffRaise: 0, missFold: 0, missCall: 0 }); for (const f in y) y[f] += x[f] || 0; }
const rankOf = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = Array(v.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = prs => { if (prs.length < 10) return NaN; const a = rankOf(prs.map(x => x[0])), b = rankOf(prs.map(x => x[1])), n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
const pct = (a, n) => (n ? (100 * a / n).toFixed(0) : '-').toString().padStart(3) + '%', ev = (a, n) => (n ? (a / n).toFixed(2) : '-').toString().padStart(6);
const row = (k, x) => `${k.padEnd(28)} n=${String(x.n).padStart(5)}  fold ${pct(x.fold, x.n)}  call ${pct(x.call, x.n)}  raise ${pct(x.raise, x.n)}   EV(call) of folds ${ev(x.evFold, x.fold)}bb  of calls ${ev(x.evCall, x.call)}bb`;
console.log(`ver ${VER}, ${+N * +P} hands (${P} x ${N}, seeds ${SEED0}..${+SEED0 + +P - 1}): heads-up, facing a single bet after the flop (EV = the call's EV with no more chips, from the bettor's actual hand)`);
console.log('\nN2  turn, bet under 45% of the pot, by hand class');
for (const c of ['overpair', 'trips+', 'twopair', 'toppair', 'pair', 'underpair', 'high']) if (st[`T small ${c}`]) console.log(row(`T small ${c}`, st[`T small ${c}`]));
console.log('\nN3  flop, bet under 45% of the pot, high-card hands');
for (const k of ['F small high', 'F small high with-BDFD', 'F small high no-BDFD', 'F small high nodraw with-BDFD', 'F small high nodraw no-BDFD']) if (st[k]) console.log(row(k, st[k]));
console.log('\nN4  raises when facing a bet (bluff raise = a raise with under 40% equity against the actual hand)');
for (const s of 'FTR') { const x = st[`${s} all`]; if (x) console.log(`${s} all`.padEnd(28) + ` n=${String(x.n).padStart(5)}  raise ${pct(x.raise, x.n)}  of the raises, bluffs ${pct(x.bluffRaise, x.raise)}  (${x.bluffRaise}/${x.raise})`); }
console.log('\nStep 2  the bot\'s strength order against the equity vs the actual hand; the loss from folds that would have earned and calls that lost (per decision)');
for (const s of 'FTR') { const x = st[`${s} all`]; if (x) console.log(`${s}`.padEnd(4) + ` n=${String(x.n).padStart(5)}  Spearman(order,equity) ${spearman((pairs[s] || []).map(x => [x[0], x[1]])).toFixed(2)}  Spearman(bot's equity vs range,equity) ${spearman((pairs[s] || []).map(x => [x[2], x[1]])).toFixed(2)}  misfold ${(x.missFold / x.n).toFixed(2)}bb  miscall ${(x.missCall / x.n).toFixed(2)}bb  fold ${pct(x.fold, x.n)} call ${pct(x.call, x.n)} raise ${pct(x.raise, x.n)}`); }
console.log('RESULT ' + JSON.stringify(st));
