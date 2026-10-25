// The new bot against itself (heads-up flops, as tests/spec-duel.mjs), its frequencies set against their theoretical values (§11 ①, CLAUDE.md):
//   facing a bet: the fold rate against the bet's price B / (P + B) (what makes a pure bluff break even; much more = folding too much)
//   the river: the share of bluffs among the bets (equity under 50% against the calling range) against B / (P + 2B) (what makes a call break even)
//   flop and turn: how often it bets, and the share of air (B5) and draws (B4) in the bets
// Usage: node tests/spec-theory.mjs [duels per process=300] [processes=4] [first seed=1] [--A=spec]   (--A: a version as spec-duel reads it, both seats)
import { fileURLToPath } from 'url'; import path from 'path';
import { options, worker } from './eval-stats.mjs';
import { LINES } from './spec-duel.mjs';
const duel = path.join(path.dirname(fileURLToPath(import.meta.url)), 'spec-duel.mjs');
const o = options(process.argv.slice(2));
const [duels = '300', procs = '4', seed0 = '1'] = o.pos;
const V = o.A || 'spec';
const t0 = Date.now();
const all = await Promise.all(Array.from({ length: +procs }, (_, i) => worker(duel, [duels, String(+seed0 + i), JSON.stringify(LINES), 'a', V, V, 'ev', 'theory'])));
const D = all.flatMap(x => x.rows).flatMap(r => r.th || []);
const ST = ['', 'flop', 'turn', 'river'];
const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
const out = { version: V, n: D.length, streets: {} };
console.log(`${V} against itself: ${D.length} decisions, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (let st = 1; st <= 3; st++) {
  const d = D.filter(x => x.st === st), res = {};
  const fb = d.filter(x => x.k === 'facingBet');
  if (fb.length) {
    const fold = fb.filter(x => x.act === 'fold').length / fb.length, raise = fb.filter(x => x.act === 'raise').length / fb.length;
    const alpha = fb.reduce((a, x) => a + x.toCall / x.pot, 0) / fb.length;
    res.facingBet = { n: fb.length, fold, raise, alpha };
    console.log(`${ST[st].padEnd(5)} facing a bet  n=${String(fb.length).padStart(5)}  fold ${pct(fold)}  (theory: at most ${pct(alpha)}; gap ${(100 * (fold - alpha)).toFixed(1)}pt)  raise ${pct(raise)}`);
  }
  const fr = d.filter(x => x.k === 'facingRaise');
  if (fr.length) {
    const fold = fr.filter(x => x.act === 'fold').length / fr.length, alpha = fr.reduce((a, x) => a + x.toCall / x.pot, 0) / fr.length;
    res.facingRaise = { n: fr.length, fold, alpha };
    console.log(`${ST[st].padEnd(5)} facing a raise n=${String(fr.length).padStart(4)}  fold ${pct(fold)}  (theory: at most ${pct(alpha)}; gap ${(100 * (fold - alpha)).toFixed(1)}pt)`);
  }
  const open = d.filter(x => x.toCall === 0), bets = open.filter(x => x.act === 'raise');
  if (open.length) {
    const byIni = {};
    for (const x of open) { const k = x.ini || 'none'; (byIni[k] = byIni[k] || [0, 0])[0]++; if (x.act === 'raise') byIni[k][1]++; }
    const air = bets.filter(x => x.b === 5).length / (bets.length || 1), draw = bets.filter(x => x.b === 4).length / (bets.length || 1);
    const size = bets.reduce((a, x) => a + x.to / x.pot, 0) / (bets.length || 1);
    const sh = open.filter(x => x.sh != null), shUp = sh.filter(x => x.sh > 0).length / (sh.length || 1), shDn = sh.filter(x => x.sh < 0).length / (sh.length || 1);
    const tg = sh.reduce((a, x) => a + (x.tgt || 0), 0) / (sh.length || 1), rf = sh.reduce((a, x) => a + (x.rf || 0), 0) / (sh.length || 1);
    console.log(`      the range's bet frequency ${pct(rf)} against the target ${pct(tg)} (Step4); the shift delta pushed bets up in ${pct(shUp)} of the spots, down in ${pct(shDn)}`);
    res.bet = { n: open.length, shUp, shDn, target: tg, rangeFreq: rf, freq: bets.length / open.length, byIni, air, draw, size };
    console.log(`${ST[st].padEnd(5)} checked to / first  n=${String(open.length).padStart(5)}  bets ${pct(bets.length / open.length)}  ` + Object.entries(byIni).map(([k, [n, b]]) => `${k} ${pct(b / n)}`).join('  ') + `  | in the bets: air ${pct(air)} draws ${pct(draw)}, mean size ${pct(size)} of the pot`);
    if (st === 3 && bets.length) {
      const bl = x => (x.Ec != null ? x.Ec : x.E) < 0.5;
      const bands = [[0, 0.4], [0.4, 0.8], [0.8, 1.3], [1.3, 99]];
      res.riverBluff = [];
      for (const [lo, hi] of bands) {
        const b = bets.filter(x => x.to / x.pot >= lo && x.to / x.pot < hi); if (!b.length) continue;
        const share = b.filter(bl).length / b.length, th = b.reduce((a, x) => { const s = x.to / x.pot; return a + s / (1 + 2 * s); }, 0) / b.length;
        res.riverBluff.push({ lo, hi, n: b.length, share, theory: th });
        console.log(`      river bets ${lo}-${hi === 99 ? '' : hi}x pot  n=${String(b.length).padStart(4)}  bluffs ${pct(share)}  (theory ${pct(th)}; gap ${(100 * (share - th)).toFixed(1)}pt)`);
      }
    }
  }
  // §3's multipliers against the bot's own play: how often each bucket takes the action (the multipliers are relative: compare the shape)
  if (open.length) {
    const um = { betSmall: [], betBig: [], check: [] };
    for (let b = 1; b <= 5; b++) {
      const o = open.filter(x => x.b === b); if (!o.length) { for (const k in um) um[k].push(null); continue; }
      const big = o.filter(x => x.act === 'raise' && x.to / x.pot >= 0.75).length, small = o.filter(x => x.act === 'raise' && x.to / x.pot < 0.75).length;
      um.betSmall.push(small / o.length); um.betBig.push(big / o.length); um.check.push(1 - (small + big) / o.length);
    }
    const fbB = []; for (let b = 1; b <= 5; b++) { const o = fb.filter(x => x.b === b); fbB.push(o.length ? o.filter(x => x.act !== 'fold').length / o.length : null); }
    const fmtP = a => a.map(x => x == null ? '  -  ' : (100 * x).toFixed(0).padStart(4) + '%').join(' ');
    const rB = [], crB = []; for (let b = 1; b <= 5; b++) { const o = fb.filter(x => x.b === b); rB.push(o.length ? o.filter(x => x.act === 'raise').length / o.length : null); const q = fr.filter(x => x.b === b); crB.push(q.length ? q.filter(x => x.act !== 'fold').length / q.length : null); }
    const share = a => { const n = a.length || 1; return [1, 2, 3, 4, 5].map(b => a.filter(x => x.b === b).length / n); };
    console.log(`      by bucket B1..B5: raise vs a bet ${fmtP(rB)} | continue vs a raise ${fmtP(crB)} | the hands facing a raise ${fmtP(share(fr))}`);
    res.byBucket = Object.assign(um, { continueVsBet: fbB, raiseVsBet: rB, continueVsRaise: crB });
    const fmt = a => a.map(x => x == null ? '  -  ' : (100 * x).toFixed(0).padStart(4) + '%').join(' ');
    console.log(`      by bucket B1..B5: bet small ${fmt(um.betSmall)} | bet big ${fmt(um.betBig)} | check ${fmt(um.check)} | continue vs a bet ${fmt(fbB)}`);
  }
  out.streets[ST[st]] = res;
}
console.log('RESULT ' + JSON.stringify(out));
