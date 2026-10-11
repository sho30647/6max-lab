// Field simulation check: plays whole tournaments with every player (hero included) simulated by the light model.
// usage: node tests/mtt-sim.mjs [runs]
import { createRequire } from 'module';
const MTT = createRequire(import.meta.url)('../mtt/core.js');
const runs = +process.argv[2] || 300;
const lvlIdx = t => MTT.clockAt(t).level + 1;
const stat = { itmClock: [], endClock: [], itmLevel: [], endLevel: [], hands: [], maxStackRatio: [], avgBBatITM: [], heroPlace: [], under10: [], tablesAtBubble: [], moves: [] };
const bad = [];
const t0 = Date.now();
for (let r = 0; r < runs; r++) {
  const T = MTT.create({ seed: 1000 + r, speed: 2, heroLight: true });
  T.onBust = (T, p) => {
    const sizes = MTT.liveTables(T).map(t => MTT.count(t));
    if (sizes.some(n => n > MTT.SEATS)) bad.push('run ' + r + ' table over 8');
    if (p.place === MTT.PAID + 1) { const alive = T.players.filter(q => !q.out), st = alive.map(q => q.stack), bb = MTT.clockAt(T.clock).lvl.bb;
      stat.avgBBatITM.push(st.reduce((a, b) => a + b, 0) / st.length / bb); stat.maxStackRatio.push(Math.max(...st) / (st.reduce((a, b) => a + b, 0) / st.length));
      stat.under10.push(st.filter(x => x < 10 * bb).length / st.length); stat.tablesAtBubble.push(sizes.length); }
  };
  T.onRebalance = T => { const sizes = MTT.liveTables(T).map(t => MTT.count(t));
    if (sizes.length !== Math.ceil(T.remaining / MTT.SEATS)) bad.push('run ' + r + ' tables ' + sizes.length + ' for ' + T.remaining + ' players');
    if (Math.max(...sizes) - Math.min(...sizes) > 1) bad.push('run ' + r + ' unbalanced ' + sizes + ' at ' + T.remaining + ' left'); };
  MTT.runAll(T);
  const bubble = T.busts.find(b => b.place === MTT.PAID + 1), winner = T.busts.find(b => b.place === 1);
  if (!T.done) { bad.push('run ' + r + ' did not finish'); continue; }
  const total = T.players.reduce((a, p) => a + p.stack, 0), win = T.players.find(p => p.place === 1);
  if (total !== MTT.FIELD * MTT.START_STACK || win.stack !== total) bad.push('run ' + r + ' chips not conserved: ' + total);
  stat.moves.push(T.moves.length);
  const places = T.players.map(p => p.place).sort((a, b) => a - b);
  if (places.some((p, i) => p !== i + 1)) bad.push('run ' + r + ' places are not 1..100');
  stat.itmClock.push(bubble.at); stat.endClock.push(winner.at); stat.itmLevel.push(lvlIdx(bubble.at)); stat.endLevel.push(lvlIdx(winner.at)); stat.hands.push(T.handsPlayed);
  stat.heroPlace.push(T.players[0].place);
}
const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const hr = s => (s / 3600).toFixed(1) + 'h';
console.log(`${runs} tournaments in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('bubble burst (16th place) at level  median', q(stat.itmLevel, .5), ' 10-90%', q(stat.itmLevel, .1), '-', q(stat.itmLevel, .9), ' | virtual time median', hr(q(stat.itmClock, .5)));
console.log('winner decided at level            median', q(stat.endLevel, .5), ' 10-90%', q(stat.endLevel, .1), '-', q(stat.endLevel, .9), ' | virtual time median', hr(q(stat.endClock, .5)));
console.log('at the bubble: avg stack mean', mean(stat.avgBBatITM).toFixed(1) + 'bb, biggest stack / average mean', mean(stat.maxStackRatio).toFixed(1) + 'x, players under 10bb', (mean(stat.under10) * 100).toFixed(0) + '%, tables', mean(stat.tablesAtBubble).toFixed(1));
console.log('table moves per tournament mean', mean(stat.moves).toFixed(0));
console.log('table-hands simulated per tournament  mean', Math.round(mean(stat.hands)));
// the hero is an ordinary player: his finishing place should be uniform
const bins = new Array(10).fill(0); stat.heroPlace.forEach(p => bins[Math.floor((p - 1) / 10)]++);
const exp = runs / 10, chi = bins.reduce((a, b) => a + (b - exp) ** 2 / exp, 0);
console.log('hero place histogram (1-10 ... 91-100):', bins.join(' '), ' chi2(9df)=' + chi.toFixed(1), '(5% limit 16.9)');
const itm = stat.heroPlace.filter(p => p <= MTT.PAID).length / runs;
console.log('hero ITM rate', (itm * 100).toFixed(1) + '% (expect 15%)', ' mean prize', Math.round(mean(stat.heroPlace.map(MTT.prizeFor))), '(expect 45,000)');
if (bad.length) { console.log('PROBLEMS:', bad.slice(0, 5)); process.exit(1); }
