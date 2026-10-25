// Shared by the bot evaluations (tests/spec-eval.mjs, tests/spec-duel.mjs, tests/bot-eval.mjs): the batches, the stopping rule and the verdict.
// The stopping rule looks only at the width of the interval, never at the mean: "run until the 95% interval is +-X wide" can stop at any
// time without making a chance difference look real (stopping when the mean first looks significant would).
import { spawn } from 'child_process';

export const stat = (rs, key = 'd') => { const n = rs.length; if (!n) return { n, mean: 0, se: 0 }; const m = rs.reduce((a, r) => a + r[key], 0) / n; const sd = Math.sqrt(rs.reduce((a, r) => a + (r[key] - m) ** 2, 0) / Math.max(1, n - 1)); return { n, mean: m, se: sd / Math.sqrt(n) }; };

// options from the command line: --precision=2 (stop when the 95% half-width is <= 2 bb/100), --minutes=30 (stop after 30 minutes), --raw (no all-in EV), --A= --B=
export function options(argv) {
  const o = { pos: [] };
  for (const a of argv) { const m = a.match(/^--([\w-]+)(?:=(.*))?$/); if (m) o[m[1]] = m[2] === undefined ? true : m[2]; else o.pos.push(a); }
  return o;
}

// one worker process: node <script> --worker ...args; resolves with the JSON after "RESULT "
export function worker(script, args) {
  return new Promise((res, rej) => {
    const c = spawn('node', [script, '--worker', ...args]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-600))); });
  });
}

// batches of `procs` workers until the half-width is reached (summary(rows).se), the time is up, or (no precision and no minutes) after one batch.
// runBatch(seeds) -> Promise<rows>; summary(rows) -> {mean, se} in the unit of the precision
export async function runBatches({ procs, seed0, precision, minutes, runBatch, summary, label = '' }) {
  const t0 = Date.now(), rows = []; let batch = 0;
  for (;;) {
    const seeds = Array.from({ length: procs }, (_, i) => seed0 + batch * procs + i);
    rows.push(...await runBatch(seeds)); batch++;
    const s = summary(rows), hw = 1.96 * s.se, min = (Date.now() - t0) / 60000;
    if (!precision && !minutes) break;
    const left = precision && hw > precision ? min * ((hw / precision) ** 2 - 1) : 0;   // the half-width shrinks with the square root of the samples
    console.log(`  … ${label}${rows.length} samples, ${min.toFixed(1)} min: ${s.mean.toFixed(1)} ± ${hw.toFixed(1)}` + (left ? `  (about ${Math.ceil(left)} more min to ±${precision})` : ''));
    if (precision && hw <= precision) break;
    if (minutes && min >= +minutes) break;
  }
  return { rows, batches: batch, minutes: (Date.now() - t0) / 60000 };
}

// the verdict in plain words (bb/100: A minus B)
export function verdict(mean, se, A = '新ボット', B = '旧ボット') {
  const lo = mean - 1.96 * se, hi = mean + 1.96 * se, f = x => (x >= 0 ? '+' : '') + x.toFixed(1);
  const range = `（${f(lo)} 〜 ${f(hi)} bb/100、95%）`;
  if (lo > 0) return `判定：${A}が強い。差は ${f(mean)} bb/100 ${range}`;
  if (hi < 0) return `判定：${A}が弱い。差は ${f(mean)} bb/100 ${range}`;
  return `判定：差は見分けられない。差があっても ${f(lo)} 〜 ${f(hi)} bb/100 の間（95%）`;
}
