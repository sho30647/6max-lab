// Spec bot, §3 Step1: a call of a bet is read with the row of its street (docs/decisions.md 2026-10-28).
// The bot's own nut-class hands (B1) raise a bet far more often on the flop than on the river, so the share of B1 among its calls grows street
// by street. One row for all streets (B1 0.5) read the caller's range too strong on the turn and the river (B1 read 10% / 16%, the hands 7% / 10%,
// tests/spec-theory.mjs). Checked here with a stand-in game in node:
//   1. updateMult.callBet has a row per street (flop / turn / river)
//   2. a call on the flop is read with the flop's row, a call on the turn with the turn's (index.js onAction)
//   3. the rows keep the shape of the bot's own calls: B1 under B2 on every street, and B1's multiplier grows flop < turn < river
// Before 2026-10-28 (one row 0.5 / 1.0 / 0.9 / 0.9 / 0.1 for all streets) checks 1-3 failed.
// Usage: node tests/spec-callbet.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SB = require('../bot/spec/index.js'), C = require('../bot/spec/cards.js'), P = require('../bot/spec/params.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const row = P.DEFAULTS.equilibrium.updateMult.callBet;
const perStreet = row && !Array.isArray(row) && ['flop', 'turn', 'river'].every(k => Array.isArray(row[k]) && row[k].length === 5);
check(perStreet, 'updateMult.callBet has a row per street');
if (!perStreet) { console.log(`${fails} failed`); process.exit(1); }

// heads-up single-raised pot: BTN (seat 0) opens, BB (seat 2) calls; flop BB checks, BTN bets, BB calls; turn the same
const POS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
const deck = C.parseCards('AhKdQcJs9h8d7c6s5h4d3c2s');
const S = { players: POS.map((p, i) => ({ name: p, hole: [deck[2 * i], deck[2 * i + 1]], stack: 9000, bet: 0, folded: i !== 0 && i !== 2, ver: 'spec' })),
  board: C.parseCards('2dKh7s'), street: 0, pfRaises: 2, pfAggr: 0, prevStreetAggr: -1, currentBet: 0, raiseCount: 0 };
const order = s => (s + 5) % 6;
const G = { S, BB: () => 100, potTotal: () => 600, posOf: s => POS[s], postOrder: order,
  isIP: s => S.players.every((q, i) => q.folded || i === s || order(i) < order(s)), legacy: () => ({ act: 'check' }) };
SB.attach(G); SB.setEquityMode('exact'); SB.newHand();
SB.onAction(0, { street: 0, act: 'raise', to: 250, potBefore: 150, toCall: 0, allIn: false, pre: { spot: 'BTN', kind: 'open' } });
SB.onAction(2, { street: 0, act: 'call', to: 250, potBefore: 400, toCall: 150, allIn: false, pre: { spot: 'BB', kind: 'vsOpen' } });
const callMult = street => {
  S.street = street; if (street === 2) { S.board = S.board.concat(C.parseCards('3c')); S.prevStreetAggr = 0; }
  SB.onAction(2, { street, act: 'check', to: 0, potBefore: 600, toCall: 0, allIn: false });
  SB.onAction(0, { street, act: 'bet', to: 400, potBefore: 600, toCall: 0, allIn: false });
  SB.onAction(2, { street, act: 'call', to: 400, potBefore: 1000, toCall: 400, allIn: false });
  const ups = [...SB.views.values()][0].updates.filter(u => u.seat === 2 && u.act === 'call');
  return ups.length ? ups[ups.length - 1].mult : null;
};
const same = (a, b) => a && b && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
const mf = callMult(1), mt = callMult(2);
check(same(mf, row.flop), `a flop call is read with the flop's row (${mf && mf.join(' ')})`);
check(same(mt, row.turn), `a turn call is read with the turn's row (${mt && mt.join(' ')})`);
for (const k of ['flop', 'turn', 'river']) check(row[k][0] < row[k][1], `${k}: B1 ${row[k][0]} under B2 ${row[k][1]} (B1 raises more than it calls)`);
check(row.flop[0] < row.turn[0] && row.turn[0] < row.river[0], `B1 grows street by street: ${row.flop[0]} < ${row.turn[0]} < ${row.river[0]}`);
console.log(fails ? `${fails} failed` : 'spec-callbet: all passed');
process.exit(fails ? 1 : 0);
