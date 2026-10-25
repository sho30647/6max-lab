// The bot evaluation, by what the change is about. One command, a plain verdict at the end.
// Which one: `full` reaches a given precision about 1.8x sooner (measured 2026-10-25, spec vs v13: SE 3.3 in 3.0 min for full, 2.9 in 6.9 min for
// postflop): the deals that end preflop are almost free, and the duel's flops are the bigger pots. So `full` is the default verdict for any change;
// `postflop` is for the breakdown by line (which heads-up flops the change wins or loses in).
//   node tests/bot-eval.mjs postflop [--precision=3] [--minutes=60] [--A=spec --B=13] [--raw]
//     a postflop change: only heads-up flops are played (tests/spec-duel.mjs): the hands from the charts' ranges of each line, the pot the line makes.
//     The deals that end preflop (most of them) are not played at all: in a duplicate match they differ by exactly 0 anyway, they would only cost time.
//   node tests/bot-eval.mjs full [--precision=3] [--minutes=60] [--A= --B=] [--raw]
//     a change that acts preflop too (or the whole game): every deal of the 6-max table (tests/spec-eval.mjs).
// Both are duplicate matches (the same cards twice, the seats swapped) and count all-ins before the river at their EV (--raw: as dealt).
// They run batches until the 95% interval is +-precision bb/100 (per dealt hand and player) or the minutes are up, whichever comes first.
// The stopping rule looks only at the interval's width, so stopping early does not make a chance difference look real.
// Defaults: --precision=3 --minutes=60. A versions: spec (the new bot), 13 (the old bot), "13+riverBluff=3" (with a tweak).
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [purpose, ...rest] = process.argv.slice(2);
const script = { postflop: 'spec-duel.mjs', full: 'spec-eval.mjs' }[purpose];
if (!script) { console.log('usage: node tests/bot-eval.mjs postflop|full [--precision=3] [--minutes=60] [--A=spec --B=13] [--raw]'); process.exit(2); }
const opt = rest.filter(a => a.startsWith('--'));
if (!opt.some(a => a.startsWith('--precision'))) opt.push('--precision=3');
if (!opt.some(a => a.startsWith('--minutes'))) opt.push('--minutes=60');
const batch = purpose === 'postflop' ? ['300', '4', '1'] : ['1000', '4', '1'];   // one batch: about 2 minutes on 4 cores
const pos = rest.filter(a => !a.startsWith('--'));
const c = spawn('node', [path.join(here, script), ...(pos.length ? pos : batch), ...opt], { stdio: 'inherit' });
c.on('close', code => process.exit(code));
