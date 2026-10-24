// Spec bot: the hand evaluator (bot/spec/cards.js evalHand and its fast 7-card form eval7), on hand-picked cases.
// Straights (the wheel A-5, Broadway, the ace not wrapping K-A-2), flushes (the best five of six suited cards, flush over straight),
// full houses (two trips, trips + two pairs), kickers (pair, two pair with the fifth card, trips, high card), the board playing
// (a straight / two pair on the board shared by both hands), and the rank order of the categories.
// Usage: node tests/spec-handeval.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../bot/spec/cards.js');
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };
const v = s => { const c = C.parseCards(s); const a = C.evalHand(c); if (c.length === 7) { const b = C.eval7(c[0], c[1], C.boardInfo(c.slice(2))); check(a === b, 'eval7 = evalHand for ' + s); } return a; };
const cat = s => v(s) >> 20;
const gt = (a, b, msg) => check(v(a) > v(b), msg + `: ${a} > ${b}`);
const eq = (a, b, msg) => check(v(a) === v(b), msg + `: ${a} = ${b}`);

// categories (0 high card .. 8 straight flush)
const CASES = [
  ['AhKd9s7c2h3d4c', 0], ['AhAd9s7c2h3d5c', 1], ['AhAd9s9c2h3d5c', 2], ['AhAdAs9c2h3d5c', 3], ['Ah2d3s4c5h9dKc', 4],
  ['Ah2h9h4h7hKdQc', 5], ['AhAdAs9c9h3d5c', 6], ['AhAdAsAc9h3d5c', 7], ['Ah2h3h4h5h9dKc', 8], ['ThJhQhKhAh2c3d', 8]
];
for (const [s, k] of CASES) check(cat(s) === k, `category of ${s}: ${cat(s)} (want ${k})`);
// straights
gt('ThJdQsKcAh2c3d', '9hTdJsQcKh2c3d', 'Broadway beats a K-high straight');
gt('2h3d4s5c6h9cKd', 'Ah2d3s4c5hKcQd', '6-high straight beats the wheel');
check(cat('QhKdAs2c3h8c9d') === 0, 'K-A-2-3-4 does not wrap: no straight (Q K A 2 3)');
check(cat('Ah2d3s4c5h') === 4 && (v('Ah2d3s4c5h') >> 16 & 15) === 3, 'the wheel is a 5-high straight');
gt('5h6d7s8c9hTdJc', '5h6d7s8c9hTd2c', 'seven cards in a row: the highest five count');
// flushes
gt('Ah2h9h4h7hKh3c', 'Ah2h9h4h7hQh3c', 'a flush plays its best five of six suited cards (K over Q)');
gt('2h4h6h8hTh9cJc', '7c8d9sTcJh2h3d', 'a flush beats a straight');
gt('Ah3h4h5h7hKdQc', 'Kh3h4h5h7hAdQc', 'flush kickers: A-high flush over K-high flush');
// full houses
eq('AhAdAs9c9h9d5c', 'AhAdAs9c9h2d5c', 'two trips: AAA99 either way');
gt('AhAdAs9c9h9d5c', 'KhKdKs9c9hAd5c', 'AAA99 over KKK99');
gt('9h9d9sAcAh3d5c', '9h9d9sKcKh3d5c', 'same trips: the pair decides (999AA over 999KK)');
eq('9h9d9sAcAhKdKc', '9h9d9sAcAh2d2c', 'trips + two pairs: the higher pair plays');
gt('AhAd2s2c2h2d5c', 'AhAdAs9c9h3d5c', 'four of a kind 2222 beats AAA99');
// kickers
gt('AhAdKs7c2h3d5c', 'AhAdQs7c2h3d5c', 'pair of aces: K kicker over Q kicker');
eq('AhAdKsQcJh3d2c', 'AhAdKsQcJh4d2c', 'pair: only three kickers count (the 3 / 4 do not)');
gt('AhAd9s9cKh3d5c', 'AhAd9s9cQh3d5c', 'two pair: the fifth card decides');
gt('AhAd9s9c5h5dKc', 'AhAd9s9c5h5dQc', 'three pairs: the third pair or a higher single is the kicker');
gt('7h7d7sAcKh3d2c', '7h7d7sAcQh3d2c', 'trips: the second kicker');
gt('AhKdJs9c7h3d2c', 'AhKdJs9c6h3d2c', 'high card: the fifth card decides');
// the board plays
eq('2c3dAhKdQsJcTh', '4c5dAhKdQsJcTh', 'a straight on the board: both hands play the board (split)');
eq('2c3dAhAdKsKc9h', '4c5dAhAdKsKc9h', 'two pair on the board with an ace kicker on the board: split');
gt('Qc3dAhAdKsKc9h', '4c5dAhAdKsKc9h', 'two pair on the board: a Q kicker beats the board\'s 9');
console.log(fails ? `${fails} failed` : 'spec-handeval: all passed');
process.exit(fails ? 1 : 0);
