// League of exploiters for the ring bots (docs/bot-lab): each exploiter is the bot under test with one deviation (a delta of BOT_TWEAKS knobs).
// An exploiter that wins against the bot shows a leak; the most any exploiter wins is the bot's exploitability (as far as the league can tell).
// A bot near an equilibrium loses little to any deviation of itself.
// Usage: node tests/ring-league.mjs probe [spec=champion] [deals per process=1000] [seed=1] [--save]
//          every exploiter against <spec>; --save stores it in league.json as the champion's probe (spec must be the champion)
//        node tests/ring-league.mjs eval <candidate> [deals per process=1000] [seed=1]
//          the candidate against the champion head-to-head, then its own probe; the verdict compares it with the champion's probe
//          (measured again when the stored one used another seed or size)
//        node tests/ring-league.mjs confirm <candidate> [deals per process=1000] [seed=101]
//          after an eval PASS, on other seeds: head-to-head again, and the exploiters that won most against the champion or the candidate
//          (top 3 of each, from the stored probe and the candidate's last probe) against both
// Every measurement is appended to docs/bot-lab/results.jsonl.
import { execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const par = path.join(here, 'ring-bench-par.mjs'), LEAGUE = path.resolve(here, '../docs/bot-lab/league.json'), LOG = path.resolve(here, '../docs/bot-lab/results.jsonl');
const MIN_GAIN = 1.0;   // bb/100: how much lower the candidate's exploitability must be to count as better
const league = JSON.parse(fs.readFileSync(LEAGUE, 'utf8'));
const args = process.argv.slice(2).filter(a => !a.startsWith('--')), save = process.argv.includes('--save');
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
  const worst = Object.entries(results).sort((a, b) => b[1].mean - a[1].mean)[0];
  const p = { spec, deals: deals * 4, seed, results, worst: { id: worst[0], ...worst[1] } };
  log({ kind: 'probe', ...p }); return p;
}
const fmt = p => `${p.worst.id} ${p.worst.mean.toFixed(1)} ± ${p.worst.ci.toFixed(1)}`;
if (mode === 'probe') {
  const spec = specArg || league.champion;
  console.log(`probe ${spec}: exploiter minus ${spec}, bb/100 per player, ${deals * 4} duplicate deals each, seed ${seed} (positive = the exploiter wins = a leak)`);
  const p = probe(spec);
  console.log(`exploitability (the most any exploiter wins): ${fmt(p)}`);
  if (save) { if (spec !== league.champion) throw new Error('--save stores the champion\'s probe only'); league.probe = { ...p, date: new Date().toISOString().slice(0, 10) }; fs.writeFileSync(LEAGUE, JSON.stringify(league, null, 2) + '\n'); console.log('saved to league.json'); }
} else if (mode === 'eval') {
  const cand = specArg, champ = league.champion; if (!cand) throw new Error('eval needs a candidate spec');
  console.log(`eval ${cand} against the champion ${champ}, ${deals * 4} duplicate deals per match, seed ${seed}`);
  const h2h = match(cand, champ); console.log(`head-to-head: ${h2h.mean.toFixed(1)} ± ${h2h.ci.toFixed(1)} (positive = the candidate wins)`);
  let cp = league.probe;
  if (!cp || cp.spec !== champ || cp.deals !== deals * 4 || cp.seed !== seed) { console.log(`champion's probe (not stored for these settings):`); cp = probe(champ); }
  console.log(`candidate's probe:`); const np = probe(cand);
  console.log('exploiter        vs champion        vs candidate');
  for (const x of league.exploiters) { const a = cp.results[x.id], b = np.results[x.id]; console.log(`  ${x.id.padEnd(14)} ${a ? (a.mean.toFixed(1) + ' ± ' + a.ci.toFixed(1)).padEnd(18) : '-'.padEnd(18)} ${b.mean.toFixed(1)} ± ${b.ci.toFixed(1)}`); }
  const notWorse = h2h.mean >= -h2h.ci, lessExploitable = np.worst.mean <= cp.worst.mean - MIN_GAIN;
  const verdict = notWorse && lessExploitable ? 'PASS' : 'FAIL';
  console.log(`exploitability: champion ${fmt(cp)}  ->  candidate ${fmt(np)}`);
  console.log(`${verdict}: head-to-head ${notWorse ? 'not worse' : 'worse'}; exploitability ${lessExploitable ? `lower by ${(cp.worst.mean - np.worst.mean).toFixed(1)}` : `not lower by ${MIN_GAIN}+`}`);
  log({ kind: 'eval', cand, champ, deals: deals * 4, seed, h2h, champWorst: cp.worst, candWorst: np.worst, verdict });
  console.log('RESULT ' + JSON.stringify({ verdict, h2h, champWorst: cp.worst, candWorst: np.worst }));
} else if (mode === 'confirm') {
  const cand = specArg, champ = league.champion, s = +seedArg || 101; if (!cand) throw new Error('confirm needs a candidate spec');
  const lastProbe = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.kind === 'probe' && x.spec === cand).pop();
  if (!league.probe || league.probe.spec !== champ || !lastProbe) throw new Error('run the champion\'s probe (--save) and eval <candidate> first');
  const top = r => Object.entries(r).sort((a, b) => b[1].mean - a[1].mean).slice(0, 3).map(x => x[0]);
  const ids = [...new Set([...top(league.probe.results), ...top(lastProbe.results)])];
  console.log(`confirm ${cand} against ${champ}, seed ${s}, ${deals * 4} duplicate deals per match; exploiters ${ids.join(', ')}`);
  const h2h = match(cand, champ, s); console.log(`head-to-head: ${h2h.mean.toFixed(1)} ± ${h2h.ci.toFixed(1)}`);
  let wc = -Infinity, wn = -Infinity;
  for (const id of ids) { const d = league.exploiters.find(x => x.id === id).delta, a = match(champ + d, champ, s), b = match(cand + d, cand, s); wc = Math.max(wc, a.mean); wn = Math.max(wn, b.mean);
    console.log(`  ${id.padEnd(14)} vs champion ${a.mean.toFixed(1)} ± ${a.ci.toFixed(1)}   vs candidate ${b.mean.toFixed(1)} ± ${b.ci.toFixed(1)}`); }
  const verdict = h2h.mean >= -h2h.ci && wn <= wc - MIN_GAIN ? 'PASS' : 'FAIL';
  console.log(`${verdict}: the most these exploiters win: champion ${wc.toFixed(1)} -> candidate ${wn.toFixed(1)}`);
  log({ kind: 'confirm', cand, champ, deals: deals * 4, seed: s, ids, h2h, champWorst: wc, candWorst: wn, verdict });
  console.log('RESULT ' + JSON.stringify({ verdict, h2h, champWorst: wc, candWorst: wn }));
} else {
  console.log('usage: node tests/ring-league.mjs probe [spec] [deals] [seed] [--save] | eval <candidate> [deals] [seed] | confirm <candidate> [deals] [seed]'); process.exit(1);
}
