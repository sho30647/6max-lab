// Spec bot, played in the game: decisions, traces, explanations and speed (docs/postflop_spec.md §0, §12).
// 1. every postflop decision of a 'spec' bot leaves a complete trace (all of §12's parts; a hand-over: step0, other and the decision)
// 2. the explanation's conclusion (action and size) is the action the game applied (recorded here, apart from the bot)
// 3. no "説明テンプレート未定義" in any explanation; the node kinds c-bet, probe, facing a bet and facing a raise all occur and are explained
// 4. speed: the time of each decision, the trace included, plus the street's set-up when it ran just before it (one blocking chunk);
//    the 95th percentile and the largest must be within 0.5 s (CPU x1); with the CPU slowed 4x (a phone) the numbers are reported
// 5. no page errors, no decision that fell back on an error
// Usage: node tests/spec-decisions.mjs [deals=120] [cpu=1]   (MODE=exact|split3|split2 forces the flop's equity mode)
import { openGame } from './spec-harness.mjs';
const N = +process.argv[2] || 120, CPU = +process.argv[3] || 1;
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const { browser, page, errors } = await openGame({ cpu: CPU > 1 ? CPU : 0 });
const out = await page.evaluate(async ([N, MODE]) => {
  if (MODE) SpecBot.setEquityMode(MODE);   // force the flop's equity mode (exact / split3 / split2) instead of the timed probe
  // the game's actions, recorded apart from the bot
  const applied = []; const origApply = window.applyAction;
  window.applyAction = function (seat, dec) { const p = S.players[seat], st = S.street, wasBet = S.currentBet === 0, toCall = S.currentBet - p.bet; origApply(seat, dec); if (st > 0) applied.push({ hand: SpecBot.hand && SpecBot.hand.id, seat, st, act: p.folded ? 'fold' : dec.act === 'raise' ? (wasBet ? 'bet' : 'raise') : dec.act === 'call' && toCall === 0 ? 'check' : dec.act, to: p.bet, toCall, allIn: p.allIn }); };
  // the blocking time of the bot: each decide, plus the street set-up when an onAction just before it ran it
  const chunks = []; let setupMs = 0;
  const oA = SpecBot.onAction, oD = SpecBot.decide;
  SpecBot.onAction = function () { const t = performance.now(); const r = oA.apply(this, arguments); setupMs = Math.max(setupMs, performance.now() - t); return r; };
  SpecBot.decide = function (seat) { const t = performance.now(); const r = oD.call(this, seat); const ms = performance.now() - t; const tr = SpecBot.hand.records[SpecBot.hand.records.length - 1]; if (!tr.other.fallback) chunks.push({ ms, setup: setupMs, street: S.street, kind: tr.step0.nodeKind }); setupMs = 0; return r; };
  for (let d = 0; d < N; d++) {
    S.players.forEach((p, i) => { p.ver = d % 3 === 2 ? (i % 2 ? 'spec' : 13) : 'spec'; });   // two of three deals all-spec, the rest spec against v13
    S.resetStacks = true; S.button = d % 6; Store.hands.length = 0; __seed(5150 + d * 7);
    await playHand();
  }
  const recs = __hands.flatMap(h => h.records.map(r => Object.assign(r, { handId: h.id })));
  // 2. conclusion vs the applied action
  const bad = [], und = [], kinds = {}, missing = [];
  const fmt = (chips) => (Math.round(chips / 100 * 10) / 10) + 'bb';
  for (const r of recs) {
    const a = applied.find(x => x.hand === r.handId && x.seat === r.seat && x.st === r.street && !x.used && true);
    if (a) a.used = true;
    const ex = SpecBot.explain(r), line = ex.lines.find(l => l.startsWith('結論：')) || '';
    und.push(...ex.undefined.map(u => r.step0.nodeKind + ' ' + u));
    if (!r.other.fallback) kinds[r.step0.nodeKind] = (kinds[r.step0.nodeKind] || 0) + 1;
    const m = SpecTrace.missing(r); if (m.length) missing.push([r.step0.nodeKind, r.other.fallback, m]);
    if (!a) { bad.push(['no applied action', r.seat, r.street]); continue; }
    let want;
    if (a.act === 'check') want = '結論：チェック';
    else if (a.act === 'fold') want = '結論：フォールド';
    else if (a.act === 'call') want = '結論：コール（' + fmt(a.toCall) + '）';
    else if (a.act === 'bet') want = '結論：ポットの' + Math.round(a.to / r.step0.pot * 100) + '%をベット（' + fmt(a.to) + '）';
    else if (a.act === 'raise') want = '結論：' + fmt(a.to) + 'にレイズ';
    if (!line.startsWith(want)) bad.push([want, line]);
    // the trace's own decision is the bot's answer before the game's rounding: the same action
    const dAct = r.decision.act === 'raise' ? (r.step0.toCall === 0 ? 'bet' : 'raise') : r.decision.act;
    if (dAct !== a.act && !(a.act === 'call' && dAct === 'raise' && a.allIn)) bad.push(['decision', dAct, a.act]);
  }
  const ms = chunks.map(c => c.ms + c.setup).sort((x, y) => x - y), q = f => Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * f))]);
  const byStreet = [1, 2, 3].map(st => { const a = chunks.filter(c => c.street === st).map(c => c.ms + c.setup).sort((x, y) => x - y); return a.length ? { n: a.length, p50: Math.round(a[a.length >> 1]), p95: Math.round(a[Math.floor(a.length * 0.95)]), max: Math.round(a[a.length - 1]) } : null; });
  const samples = {}; for (const r of recs) { const k = r.other.fallback ? 'legacy:' + r.other.fallback : r.step0.nodeKind; if (!samples[k]) samples[k] = SpecBot.explain(r).text; }
  return { n: recs.length, bad: bad.slice(0, 5), nBad: bad.length, und: [...new Set(und)].slice(0, 10), kinds, missing: missing.slice(0, 5), nMissing: missing.length,
    speed: { n: ms.length, p50: q(0.5), p95: q(0.95), max: Math.round(ms[ms.length - 1]), byStreet }, counts: SpecBot.counts, samples };
}, [N, process.env.MODE || null]);
check(out.nBad === 0, `the explanation's conclusion differs from the applied action (${out.nBad}): ` + JSON.stringify(out.bad));
check(out.und.length === 0, 'templates missing: ' + JSON.stringify(out.und));
for (const k of ['cbet', 'probe', 'facingBet', 'facingRaise']) check(out.kinds[k] > 0, `node kind ${k} did not occur (${JSON.stringify(out.kinds)})`);
check(out.nMissing === 0, 'incomplete traces: ' + JSON.stringify(out.missing));
check(!out.counts.legacy.error, 'decisions that fell back on an error: ' + out.counts.legacy.error);
if (CPU <= 1) check(out.speed.p95 <= 500 && out.speed.max <= 500, 'decision time over 0.5 s: ' + JSON.stringify(out.speed));
check(errors.length === 0, 'page errors: ' + errors.slice(0, 3).join(' | '));
console.log(`decisions ${out.n}, node kinds ${JSON.stringify(out.kinds)}, counts ${JSON.stringify(out.counts)}`);
console.log(`speed (CPU x${CPU}, ms, the decision + the street set-up before it): ${JSON.stringify(out.speed)}`);
if (process.env.SAMPLES) (await import('fs')).writeFileSync(process.env.SAMPLES, JSON.stringify(out.samples));
console.log(fails ? `${fails} failed` : 'spec-decisions: all passed');
await browser.close();
process.exit(fails ? 1 : 0);
