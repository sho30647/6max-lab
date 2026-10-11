// The live-table path: the hero's table is played "by the engine" (here a stand-in that uses the light hand) and reported hand by hand.
import { createRequire } from 'module';
const MTT = createRequire(import.meta.url)('../mtt/core.js');
const bad = []; let heroOutCount = 0, itm = 0, moves = 0, tableChanges = 0, breaksWaited = 0;
const RUNS = +process.argv[2] || 60;
for (let r = 0; r < RUNS; r++) {
  const T = MTT.create({ seed: 77 + r, speed: 2 });
  for (let guard = 0; guard < 5000 && !T.done && !T.players[0].out; guard++) {
    const prevTable = T.players[0].tableId, b = MTT.beginLiveHand(T);
    if (b.pids[0] !== 0) bad.push('hero not first'); if (new Set(b.pids).size !== b.pids.length || b.pids.length > 8 || b.pids.length < 2) bad.push('bad table ' + b.pids);
    if (b.button < 0 || b.button >= b.pids.length) bad.push('bad button');
    if (MTT.clockAt(b.at).inBreak) bad.push('hand starts in a break');
    const tb = MTT.heroTable(T), startStacks = {}; b.pids.forEach(id => startStacks[id] = T.players[id].stack);
    const before = b.pids.reduce((a, id) => a + T.players[id].stack, 0);
    const res = MTT.lightHand(T, tb, b.lvl);   // stand-in for the engine playing the hand
    const endStacks = {}; b.pids.forEach(id => endStacks[id] = T.players[id].stack);
    if (b.pids.reduce((a, id) => a + endStacks[id], 0) !== before) bad.push('chips changed in the hand');
    MTT.reportLiveHand(T, { startStacks, endStacks, seconds: res.seconds });
    if (!T.done && !T.players[0].out && T.players[0].tableId !== prevTable) tableChanges++;
  }
  if (T.players[0].out) { heroOutCount++; if (T.players[0].place <= MTT.PAID) itm++; }
  MTT.runAll(T);   // the rest of the field plays on
  if (!T.done) bad.push('run ' + r + ' did not finish');
  const places = T.players.map(p => p.place).sort((a, b) => a - b); if (places.some((p, i) => p !== i + 1)) bad.push('run ' + r + ' places not 1..100');
  const total = T.players.reduce((a, p) => a + p.stack, 0); if (total !== MTT.FIELD * MTT.START_STACK) bad.push('run ' + r + ' chips ' + total);
  moves += T.moves.filter(m => m.id === 0).length;
}
console.log(`${RUNS} tournaments with a live hero table: hero busted in ${heroOutCount}, ITM ${itm}, hero table changes ${tableChanges}`);
if (bad.length) { console.log('PROBLEMS:', [...new Set(bad)].slice(0, 6)); process.exit(1); } else console.log('ok');
