// Spec bot: the decision trace's storage (bot/spec/trace.js, docs/bot_rebuild_plan.md §8.3).
// 1. at most 50 hands are kept, the oldest go first  2. when the browser's quota is full, older hands are dropped until the new one fits
// 3. missing() names the empty parts of a decision (a decision handed to the old bot needs only step0, other and decision)
// Usage: node tests/spec-trace.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = require('../bot/spec/trace.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const mem = (limit = Infinity) => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { if (v.length > limit) throw new Error('quota'); m.set(k, v); } }; };
const rec = i => T.create({ hand: 'h' + i, seat: 1, pos: 'BTN', name: 'x', hole: [0, 1], board: [2, 3, 4], street: 1, actionNo: 0 });
{
  const st = mem();
  for (let i = 0; i < 60; i++) { const h = new T.Hand('h' + i); h.add(rec(i)); h.finish({ board: [2, 3, 4], shown: {}, actions: [] }); T.save(st, 'k', h, P.DEFAULTS.design.traceKeepHands); }
  const all = T.load(st, 'k');
  check(all.length === 50, 'kept ' + all.length);
  check(all[0].id === 'h10' && all[49].id === 'h59', 'oldest dropped first: ' + all[0].id);
}
{
  const one = JSON.stringify([{ id: 'h0', t: 0, records: [rec(0)] }]).length;
  const st = mem(one * 3.5);   // room for about 3 hands
  for (let i = 0; i < 10; i++) { const h = new T.Hand('h' + i); h.add(rec(i)); check(T.save(st, 'k', h, 50), 'saved under the quota ' + i); }
  const all = T.load(st, 'k');
  check(all.length >= 2 && all.length <= 3 && all[all.length - 1].id === 'h9', 'quota: kept ' + all.map(h => h.id).join(','));
}
{
  const t = rec(0);
  check(T.missing(t).length === 9, 'a new record misses step0..7 and decision (other is there): ' + T.missing(t));
  t.step0 = {}; t.other.fallback = 'stage0'; t.decision = { act: 'check' };
  check(T.missing(t).length === 0, 'a hand-over needs only step0, other and decision: ' + T.missing(t));
}
console.log(fails ? `${fails} failed` : 'spec-trace: all passed');
process.exit(fails ? 1 : 0);
