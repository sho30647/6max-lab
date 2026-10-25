// The all-in EV settlement of the evaluations (tests/spec-harness.mjs allinEV): checked against outs counted by hand, and off by default.
// Turn all-in: AhKh against TdTs on 2h 7h Tc Js. AhKh wins with 7 hearts (not Th, Jh, which fill up the tens) and 3 queens (Qc Qd Qs: broadway):
// 10 of the 44 rivers. Pot 200bb -> AhKh's EV = 200 x 10/44 - 100 = -54.545bb, TdTs's = +54.545bb. Without the switch: the dealt river decides.
// Also a flop all-in (990 runouts) conserves the chips, and a hand that is settled on the river is not touched.
import { openGame } from './spec-harness.mjs';
const { browser, page, errors } = await openGame();
const r = await page.evaluate(() => {
  const C = s => '23456789TJQKA'.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
  function spot(hA, hB, board, actBoard, on) {
    window.__allinEV = on; window.__actBoard = actBoard;
    S.players.forEach(p => { p.folded = true; p.hole = []; p.contrib = 0; p.bet = 0; p.stack = 10000; p.ante = 0; p.allIn = false; p.shown = false; });
    const a = S.players[1], b = S.players[2];
    for (const [p, h] of [[a, hA], [b, hB]]) { p.folded = false; p.hole = h.map(C); p.contrib = 10000; p.stack = 0; p.allIn = true; }
    S.board = board.map(C); S.winners = []; S.soleWin = new Set(); S.shared = new Set();
    settle();
    return { a: (a.stack - 10000) / 100, b: (b.stack - 10000) / 100, sum: S.players.reduce((x, p) => x + p.stack, 0) - 60000, board: S.board.length, winners: S.winners.slice() };
  }
  const turn = ['2h', '7h', 'Tc', 'Js'];
  return {
    turnEV: spot(['Ah', 'Kh'], ['Td', 'Ts'], turn.concat(['3c']), 4, true),
    turnRaw: spot(['Ah', 'Kh'], ['Td', 'Ts'], turn.concat(['3c']), 4, false),
    flopEV: spot(['As', 'Ks'], ['Qh', 'Qd'], ['2c', '7d', '9h', '3s', '4c'], 3, true),
    river: spot(['Ah', 'Kh'], ['Td', 'Ts'], turn.concat(['3h']), 5, true),
  };
});
await browser.close();
let bad = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) bad++; };
ok(Math.abs(r.turnEV.a - (200 * 10 / 44 - 100)) < 1e-6 && Math.abs(r.turnEV.b + r.turnEV.a) < 1e-6, `turn all-in at EV: AhKh ${r.turnEV.a.toFixed(3)}bb (expected ${(200 * 10 / 44 - 100).toFixed(3)}), TdTs ${r.turnEV.b.toFixed(3)}bb`);
ok(r.turnEV.board === 5 && r.turnEV.winners.length === 1 && r.turnEV.winners[0] === 2, 'the dealt board stays, and the winner shown is the one of the dealt river');
ok(r.turnRaw.a === -100 && r.turnRaw.b === 100, `switch off: the dealt river decides (AhKh ${r.turnRaw.a}bb)`);
ok(Math.abs(r.flopEV.sum) < 1e-6 && r.flopEV.a > -100 && r.flopEV.a < 0, `flop all-in at EV (990 runouts): AsKs ${r.flopEV.a.toFixed(2)}bb against QhQd, chips conserved (${r.flopEV.sum.toExponential(1)})`);
ok(r.river.a === 100 && r.river.b === -100, 'settled on the river (the last action on 5 cards): as dealt');
if (errors.length) { console.log('page errors:', errors); bad++; }
process.exit(bad ? 1 : 0);
