// Spec bot: which pots go to the old bot (docs/postflop_spec.md §2 Step0: limped pots and 3-bet pots with a cold caller, squeezes included,
// are left to the old bot in phase 1 and counted). A stand-in game in node feeds the preflop actions, then asks for a flop decision.
// Usage: node tests/spec-routing.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SB = require('../bot/spec/index.js'), C = require('../bot/spec/cards.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const POS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];   // seat i sits at POS[i] (the button on seat 0)
function game() {
  const deck = C.parseCards('AhKdQcJs9h8d7c6s5h4d3c2sTdTc2h3h');
  const S = { players: POS.map((p, i) => ({ name: p, hole: [deck[2 * i], deck[2 * i + 1]], stack: 9000, bet: 0, folded: false, ver: 'spec' })),
    board: C.parseCards('2dKh7s'), street: 0, pfRaises: 1, pfAggr: -1, prevStreetAggr: -1, currentBet: 0, raiseCount: 0 };
  const order = s => (s - 0 + 5) % 6;   // postflop order: SB first, BTN last
  let legacyCalls = 0;
  const G = { S, BB: () => 100, potTotal: () => 1000, posOf: s => POS[s], postOrder: order,
    isIP: s => S.players.every((q, i) => q.folded || i === s || order(i) < order(s)),
    legacy: () => { legacyCalls++; return { act: 'check' }; } };
  return { S, G, legacyCalls: () => legacyCalls };
}
const seat = p => POS.indexOf(p);
function run(name, pre, expect) {
  const g = game(); SB.attach(g.G); SB.newHand();
  let raises = 1;
  for (const [p, act] of pre) {
    const s = seat(p);
    if (act === 'fold') g.S.players[s].folded = true;
    if (act === 'raise') { raises++; g.S.pfAggr = s; }
    SB.onAction(s, { street: 0, act, to: 0, potBefore: 0, toCall: 0, allIn: false, pre: null });
  }
  g.S.pfRaises = raises; g.S.street = 1;
  const live = g.S.players.map((q, i) => i).filter(i => !g.S.players[i].folded);
  const first = live.sort((a, b) => g.G.postOrder(a) - g.G.postOrder(b))[0];
  SB.decide(first);
  const tr = SB.hand.records[SB.hand.records.length - 1];
  const got = tr.other.fallback || 'spec';
  check(got === expect, `${name}: ${got} (want ${expect})`);
  check(expect === 'spec' ? g.legacyCalls() === 0 : g.legacyCalls() === 1, `${name}: the old bot was ${g.legacyCalls() ? '' : 'not '}asked`);
  return got;
}
run('limped pot', [['UTG', 'call'], ['HJ', 'fold'], ['CO', 'fold'], ['BTN', 'fold'], ['SB', 'call'], ['BB', 'check']], 'legacy:limp');
run('limp, then a raise the limper calls', [['UTG', 'call'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'fold'], ['SB', 'fold'], ['BB', 'fold'], ['UTG', 'call']], 'legacy:limp');
run('3-bet pot with a cold caller', [['UTG', 'raise'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'call'], ['SB', 'fold'], ['BB', 'fold'], ['UTG', 'call']], 'legacy:cold3');
run('3-bet pot with a cold caller, the opener folds', [['UTG', 'raise'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'call'], ['SB', 'fold'], ['BB', 'fold'], ['UTG', 'fold']], 'legacy:cold3');
run('squeeze (a caller of the open, then a 3-bet), the caller folds', [['UTG', 'raise'], ['HJ', 'call'], ['CO', 'fold'], ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'fold'], ['UTG', 'call'], ['HJ', 'fold']], 'legacy:cold3');
run('single-raised pot, heads-up', [['UTG', 'fold'], ['HJ', 'fold'], ['CO', 'fold'], ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'call']], 'spec');
run('3-bet pot, heads-up', [['UTG', 'fold'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'fold'], ['CO', 'call']], 'spec');
run('4-bet pot, heads-up', [['UTG', 'fold'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'raise'], ['SB', 'fold'], ['BB', 'fold'], ['CO', 'raise'], ['BTN', 'call']], 'spec');
run('single-raised pot, three players (multiway: the new bot, §10)', [['UTG', 'fold'], ['HJ', 'fold'], ['CO', 'raise'], ['BTN', 'call'], ['SB', 'fold'], ['BB', 'call']], 'spec');
check(SB.counts.legacy['legacy:limp'] === 2 && SB.counts.legacy['legacy:cold3'] === 3, 'the hand-overs are counted by reason: ' + JSON.stringify(SB.counts.legacy));
console.log(fails ? `${fails} failed` : 'spec-routing: all passed');
process.exit(fails ? 1 : 0);
