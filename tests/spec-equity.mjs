// Spec bot, stage 1 (docs/bot_rebuild_plan.md §6): the equity engine.
// 1. bot/spec/cards.js evaluates hands exactly as index.html's evalHand (random 7-card hands)
// 2. 1,755 flop classes that stand for all 22,100 flops
// 3. StreetTable.sweep = brute force (every opponent combo x every runout) on random river / turn / flop spots with random ranges
// 4. handExact (one hand) = the sweep
// 5. Monte Carlo handVsRanges is within 1.5pt of the exact equity
// Usage: node tests/spec-equity.mjs
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = require('../bot/spec/cards.js'), E = require('../bot/spec/equity.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const deal = (n, dead = new Set()) => { const out = []; while (out.length < n) { const c = (rnd() * 52) | 0; if (!dead.has(c)) { dead.add(c); out.push(c); } } return out; };

// 1. the evaluator is the game's
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const src = html.slice(html.indexOf('function straightHigh'), html.indexOf('function classKey'));
const gameEval = new Function(src + 'return evalHand;')();
for (let k = 0; k < 20000; k++) { const h = deal(5 + (k % 3)); check(gameEval(h) === C.evalHand(h), 'evalHand ' + h.map(C.cardStr).join('')); }

// 2. flop classes
const flops = C.allCanonFlops();
check(flops.length === 1755, 'flop classes ' + flops.length);
check(flops.reduce((a, f) => a + f.n, 0) === 22100, 'flop classes cover 22100 flops');

// 3. exact sweep vs brute force
function brute(board, i, W) {
  const a = C.CA[i], b = C.CB[i], dead = new Set(board.concat([a, b]));
  const rest = []; for (let c = 0; c < 52; c++) if (!dead.has(c)) rest.push(c);
  const need = 5 - board.length, ros = [];
  if (need === 0) ros.push([]); else if (need === 1) rest.forEach(x => ros.push([x])); else for (let p = 0; p < rest.length; p++) for (let q = p + 1; q < rest.length; q++) ros.push([rest[p], rest[q]]);
  let win = 0, tot = 0;
  for (const ro of ros) {
    const bd = board.concat(ro), my = C.evalHand([a, b].concat(bd)), d2 = new Set(bd.concat([a, b]));
    for (let j = 0; j < C.NC; j++) { const w = W[j]; if (!(w > 0) || d2.has(C.CA[j]) || d2.has(C.CB[j])) continue; const v = C.evalHand([C.CA[j], C.CB[j]].concat(bd)); win += w * (my > v ? 1 : my === v ? 0.5 : 0); tot += w; }
  }
  return win / tot;
}
for (const [nb, spots, probes] of [[5, 6, 25], [4, 3, 8], [3, 1, 2]]) {
  for (let s = 0; s < spots; s++) {
    const board = deal(nb);
    const W = new Float32Array(C.NC); for (let j = 0; j < C.NC; j++) W[j] = rnd() < 0.4 ? rnd() : 0;
    const sw = new E.StreetTable(board).sweep(W, false);
    for (let p = 0; p < probes; p++) {
      let i; do { i = (rnd() * C.NC) | 0; } while (board.includes(C.CA[i]) || board.includes(C.CB[i]));
      const want = brute(board, i, W);
      check(Math.abs(sw.eq[i] - want) < 1e-5, `sweep ${board.map(C.cardStr).join('')} ${C.cardStr(C.CA[i])}${C.cardStr(C.CB[i])}: ${sw.eq[i]} vs ${want}`);
    }
  }
}
// the equity after each next card (turn spot): equals the river sweep of that card
{
  const board = deal(4), W = new Float32Array(C.NC); for (let j = 0; j < C.NC; j++) W[j] = rnd() < 0.5 ? 1 : 0;
  const sw = new E.StreetTable(board).sweep(W, true);
  for (let p = 0; p < 5; p++) {
    let i; do { i = (rnd() * C.NC) | 0; } while (board.includes(C.CA[i]) || board.includes(C.CB[i]));
    let x; do { x = (rnd() * 52) | 0; } while (board.includes(x) || x === C.CA[i] || x === C.CB[i]);
    const riv = new E.StreetTable(board.concat([x])).sweep(W, false).eq[i];
    check(Math.abs(sw.nextWin[i * 52 + x] / sw.nextTot[i * 52 + x] - riv) < 1e-5, 'next-card equity');
  }
}

// handExact = the sweep, for one hand (turn spot, with the next-card equities)
{
  const board = deal(4), W = new Float32Array(C.NC); for (let j = 0; j < C.NC; j++) W[j] = rnd() < 0.5 ? rnd() : 0;
  const sw = new E.StreetTable(board).sweep(W, true);
  for (let p = 0; p < 5; p++) {
    let i; do { i = (rnd() * C.NC) | 0; } while (board.includes(C.CA[i]) || board.includes(C.CB[i]));
    const h = E.handExact([C.CA[i], C.CB[i]], board, W);
    check(Math.abs(h.eq - sw.eq[i]) < 1e-5, 'handExact eq');
    const a = E.devVul(sw, i, 0.8, 0.5), b = E.devVulOf(h.nextEq, 0.8, 0.5);
    check(a.D === b.D && a.V === b.V, 'handExact D/V');
  }
}
// handExact = the sweep, for one hand (turn spot, with the next-card equities)
{
  const board = deal(4), W = new Float32Array(C.NC); for (let j = 0; j < C.NC; j++) W[j] = rnd() < 0.5 ? rnd() : 0;
  const sw = new E.StreetTable(board).sweep(W, true);
  for (let p = 0; p < 5; p++) {
    let i; do { i = (rnd() * C.NC) | 0; } while (board.includes(C.CA[i]) || board.includes(C.CB[i]));
    const h = E.handExact([C.CA[i], C.CB[i]], board, W);
    check(Math.abs(h.eq - sw.eq[i]) < 1e-5, 'handExact eq');
    const a = E.devVul(sw, i, 0.8, 0.5), b = E.devVulOf(h.nextEq, 0.8, 0.5);
    check(a.D === b.D && a.V === b.V, 'handExact D/V');
  }
}
// 5. Monte Carlo
{
  const board = deal(3), W = new Float32Array(C.NC).fill(1);
  const sw = new E.StreetTable(board).sweep(W, false);
  for (let p = 0; p < 3; p++) {
    let i; do { i = (rnd() * C.NC) | 0; } while (board.includes(C.CA[i]) || board.includes(C.CB[i]));
    const mc = E.handVsRanges([C.CA[i], C.CB[i]], board, [W], 20000, rnd);
    check(Math.abs(mc - sw.eq[i]) < 0.015, `MC ${mc} vs exact ${sw.eq[i]}`);
  }
}
console.log(fails ? `${fails} failed` : 'spec-equity: all passed');
process.exit(fails ? 1 : 0);
