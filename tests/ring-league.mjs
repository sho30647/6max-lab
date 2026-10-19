// League of exploiters for the ring bots (docs/bot-lab): each exploiter is the bot under test with one deviation (a delta of BOT_TWEAKS knobs).
// An exploiter that wins against the bot beyond the 95% interval shows a leak. A bot near an equilibrium has no leak against any deviation of itself.
// (The largest mean alone is no measure: the exploiter with the widest interval tends to have it by chance. Leaks are counted only beyond their interval.)
// Usage: node tests/ring-league.mjs probe [spec=champion] [deals per process=1000] [seed=1] [--save]
//          every exploiter against <spec>; --save stores it in league.json as the champion's probe (spec must be the champion)
//        node tests/ring-league.mjs eval <candidate> --target=<exploiter id> [deals per process=1000] [seed=1]
//          the candidate against the champion head-to-head, then every exploiter against it. PASS when: the head-to-head is not lost
//          (beyond its interval), the target's gain fell beyond the interval of the difference, and no exploiter became a new leak
//          (a leak against the candidate that is significantly bigger than against the champion)
//        node tests/ring-league.mjs confirm <candidate> --target=<exploiter id> [deals per process=1000] [seed=101]
//          after an eval PASS, on other seeds: the same rules on the head-to-head, the target, and the 3 exploiters that won most
//          against the candidate in its last probe
// Every measurement is appended to docs/bot-lab/results.jsonl.
import { execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const par = path.join(here, 'ring-bench-par.mjs'), LEAGUE = path.resolve(here, '../docs/bot-lab/league.json'), LOG = path.resolve(here, '../docs/bot-lab/results.jsonl');
const league = JSON.parse(fs.readFileSync(LEAGUE, 'utf8'));
const args = process.argv.slice(2).filter(a => !a.startsWith('--')), save = process.argv.includes('--save');
const target = (process.argv.find(a => a.startsWith('--target=')) || '').slice(9);
const [mode, specArg, dealsArg, seedArg] = args;
const deals = +dealsArg || 1000, seed = +seedArg || 1;
const log = x => fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), ...x }) + '\n');
function match(A, B, s = seed) {
  const out = execFileSync('node', [par, A, B, String(deals), '4', String(s)], { encoding: 'utf8' });
  const m = out.match(/^(-?[\d.]+) ± ([\d.]+)/m); if (!m) throw new Error(out.slice(-400));
  const r = { mean: +m[1], ci: +m[2] }; log({ kind: 'match', A, B, deals: deals * 4, seed: s, ...r }); return r;
}
function probe(spec) {
  const results = {};
  for (const x of league.exploiters) {
    const r = match(spec + x.delta, spec); results[x.id] = r;
    console.log(`  ${x.id.padEnd(14)} ${(spec + x.delta).padEnd(40)} ${r.mean.toFixed(1).padStart(6)} ± ${r.ci.toFixed(1)}${r.mean > r.ci ? '  * leak' : ''}`);
  }
  const leaks = Object.entries(results).filter(([, r]) => r.mean > r.ci).sort((a, b) => b[1].mean - a[1].mean).map(([id, r]) => ({ id, ...r }));
  const p = { spec, deals: deals * 4, seed, results, leaks };
  log({ kind: 'probe', ...p }); return p;
}
const fmt = p => p.leaks.length ? p.leaks.map(l => `${l.id} ${l.mean.toFixed(1)} ± ${l.ci.toFixed(1)}`).join(', ') : 'none';
// a's and b's difference beyond the interval of the difference (the runs are independent but share the deals: this interval is on the safe side)
const below = (b, a) => b.mean - a.mean < -Math.hypot(a.ci, b.ci), above = (b, a) => b.mean - a.mean > Math.hypot(a.ci, b.ci);
function judge(h2h, cr, nr, ids) {   // cr / nr: results against the champion / the candidate
  const notWorse = h2h.mean >= -h2h.ci, fixed = below(nr[target], cr[target]);
  const fresh = ids.filter(id => nr[id].mean > nr[id].ci && (!(cr[id].mean > cr[id].ci) || above(nr[id], cr[id])));
  const verdict = notWorse && fixed && !fresh.length ? 'PASS' : 'FAIL';
  console.log(`${verdict}: head-to-head ${notWorse ? 'not lost' : 'LOST'}; ${target} ${cr[target].mean.toFixed(1)} -> ${nr[target].mean.toFixed(1)} ${fixed ? 'fixed' : 'NOT fixed beyond the interval'}; new leaks: ${fresh.join(', ') || 'none'}`);
  return { verdict, notWorse, fixed, fresh };
}
if (mode === 'probe') {
  const spec = specArg || league.champion;
  console.log(`probe ${spec}: exploiter minus ${spec}, bb/100 per player, ${deals * 4} duplicate deals each, seed ${seed} (positive = the exploiter wins = a leak)`);
  const p = probe(spec);
  console.log(`leaks (beyond the 95% interval): ${fmt(p)}`);
  if (save) { if (spec !== league.champion) throw new Error('--save stores the champion\'s probe only'); league.probe = { ...p, date: new Date().toISOString().slice(0, 10) }; fs.writeFileSync(LEAGUE, JSON.stringify(league, null, 2) + '\n'); console.log('saved to league.json'); }
} else if (mode === 'eval') {
  const cand = specArg, champ = league.champion;
  if (!cand || !league.exploiters.some(x => x.id === target)) throw new Error('eval needs a candidate spec and --target=<exploiter id>');
  console.log(`eval ${cand} against the champion ${champ}, target ${target}, ${deals * 4} duplicate deals per match, seed ${seed}`);
  const h2h = match(cand, champ); console.log(`head-to-head: ${h2h.mean.toFixed(1)} ± ${h2h.ci.toFixed(1)} (positive = the candidate wins)`);
  let cp = league.probe;
  if (!cp || cp.spec !== champ || cp.deals !== deals * 4 || cp.seed !== seed) { console.log(`champion's probe (not stored for these settings):`); cp = probe(champ); }
  console.log(`candidate's probe:`); const np = probe(cand);
  console.log('exploiter        vs champion        vs candidate');
  for (const x of league.exploiters) { const a = cp.results[x.id], b = np.results[x.id]; console.log(`  ${x.id.padEnd(14)} ${a ? (a.mean.toFixed(1) + ' ± ' + a.ci.toFixed(1)).padEnd(18) : '-'.padEnd(18)} ${b.mean.toFixed(1)} ± ${b.ci.toFixed(1)}`); }
  console.log(`leaks: champion ${fmt(cp)}  ->  candidate ${fmt(np)}`);
  const ids = league.exploiters.map(x => x.id).filter(id => cp.results[id]);
  const j = judge(h2h, cp.results, np.results, ids);
  log({ kind: 'eval', cand, champ, target, deals: deals * 4, seed, h2h, champLeaks: cp.leaks, candLeaks: np.leaks, ...j });
  console.log('RESULT ' + JSON.stringify({ ...j, h2h, champLeaks: cp.leaks, candLeaks: np.leaks }));
} else if (mode === 'confirm') {
  const cand = specArg, champ = league.champion, s = +seedArg || 101;
  if (!cand || !league.exploiters.some(x => x.id === target)) throw new Error('confirm needs a candidate spec and --target=<exploiter id>');
  const lastProbe = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.kind === 'probe' && x.spec === cand).pop();
  if (!lastProbe) throw new Error('run eval <candidate> first');
  const ids = [...new Set([target, ...Object.entries(lastProbe.results).sort((a, b) => b[1].mean - a[1].mean).slice(0, 3).map(x => x[0])])];
  console.log(`confirm ${cand} against ${champ}, seed ${s}, ${deals * 4} duplicate deals per match; exploiters ${ids.join(', ')}`);
  const h2h = match(cand, champ, s); console.log(`head-to-head: ${h2h.mean.toFixed(1)} ± ${h2h.ci.toFixed(1)}`);
  const cr = {}, nr = {};
  for (const id of ids) { const d = league.exploiters.find(x => x.id === id).delta; cr[id] = match(champ + d, champ, s); nr[id] = match(cand + d, cand, s);
    console.log(`  ${id.padEnd(14)} vs champion ${cr[id].mean.toFixed(1)} ± ${cr[id].ci.toFixed(1)}   vs candidate ${nr[id].mean.toFixed(1)} ± ${nr[id].ci.toFixed(1)}`); }
  const j = judge(h2h, cr, nr, ids);
  log({ kind: 'confirm', cand, champ, target, deals: deals * 4, seed: s, ids, h2h, cr, nr, ...j });
  console.log('RESULT ' + JSON.stringify({ ...j, h2h }));
} else {
  console.log('usage: node tests/ring-league.mjs probe [spec] [deals] [seed] [--save] | eval|confirm <candidate> --target=<id> [deals] [seed]'); process.exit(1);
}
