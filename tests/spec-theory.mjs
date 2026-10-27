// The new bot against itself (heads-up flops, as tests/spec-duel.mjs), its frequencies set against their theoretical values (§11 ①, CLAUDE.md):
//   facing a bet: the fold rate against the bet's price B / (P + B) (what makes a pure bluff break even; much more = folding too much)
//   the river: the share of bluffs among the bets (equity under 50% against the calling range) against B / (P + 2B) (what makes a call break even)
//   flop and turn: how often it bets, and the share of air (B5) and draws (B4) in the bets
// Checks (the default version only): the river's bets of 0.8x pot or more hold 15%+ bluffs, and the river's fold rate against a bet is within
// 10pt of its theoretical bound (before 2026-10-26: 2% bluffs, 15pt over; docs/decisions.md)
// Usage: node tests/spec-theory.mjs [duels per process=300] [processes=4] [first seed=1] [--A=spec]   (--A: a version as spec-duel reads it, both seats)
import { fileURLToPath } from 'url'; import path from 'path';
import { options, worker } from './eval-stats.mjs';
import { LINES } from './spec-duel.mjs';
import { createRequire } from 'module';
const RG = createRequire(import.meta.url)('../bot/spec/ranges.js');
// §3 by the bet's size (docs/decisions.md 2026-10-27): the size bands around the table's sizes 33% / 75% / 125% / 200%
const BANDS = [[0, 0.5], [0.5, 1.0], [1.0, 1.6], [1.6, 99]];
const bandName = ([lo, hi]) => `${lo}-${hi === 99 ? '' : hi}x`;
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
    // split by the SPR after the call (strategy.js facing: under facingSprFull R and the margin shrink, docs/hand_reviews.md #1)
    const sprA = x => Math.max(0, x.eff - x.toCall) / (x.pot + x.toCall);
    res.facingBetSpr = {};
    for (const [key, f] of [['le1', x => sprA(x) <= 1], ['gt1', x => sprA(x) > 1]]) {
      const g = fb.filter(x => x.eff != null && f(x)); if (!g.length) continue;
      const gf = g.filter(x => x.act === 'fold').length / g.length, ga = g.reduce((a, x) => a + x.toCall / x.pot, 0) / g.length;
      res.facingBetSpr[key] = { n: g.length, fold: gf, alpha: ga };
      console.log(`      SPR after the call ${key === 'le1' ? '<= 1' : ' > 1'}  n=${String(g.length).padStart(5)}  fold ${pct(gf)}  (theory: at most ${pct(ga)}; gap ${(100 * (gf - ga)).toFixed(1)}pt)`);
    }
  }
  // facing a bet, by its size (s = the bet / the pot before it): the fold rate against B / (P + B)
  if (fb.length) {
    res.facingBetBySize = [];
    for (const band of BANDS) {
      const g = fb.filter(x => { const s = x.toCall / Math.max(1e-9, x.pot - x.toCall); return s >= band[0] && s < band[1]; }); if (!g.length) continue;
      const gf = g.filter(x => x.act === 'fold').length / g.length, ga = g.reduce((a, x) => a + x.toCall / x.pot, 0) / g.length;
      res.facingBetBySize.push({ band: bandName(band), n: g.length, fold: gf, alpha: ga });
      console.log(`      bet ${bandName(band).padEnd(8)} n=${String(g.length).padStart(5)}  fold ${pct(gf)}  (theory: at most ${pct(ga)}; gap ${(100 * (gf - ga)).toFixed(1)}pt)`);
    }
  }
  const fr = d.filter(x => x.k === 'facingRaise');
  if (fr.length) {
    const fold = fr.filter(x => x.act === 'fold').length / fr.length, alpha = fr.reduce((a, x) => a + x.toCall / x.pot, 0) / fr.length;
    res.facingRaise = { n: fr.length, fold, alpha };
    console.log(`${ST[st].padEnd(5)} facing a raise n=${String(fr.length).padStart(4)}  fold ${pct(fold)}  (theory: at most ${pct(alpha)}; gap ${(100 * (fold - alpha)).toFixed(1)}pt)`);
  }
  const open = d.filter(x => x.toCall === 0), bets = open.filter(x => x.act === 'raise');
  // §4 Step2: how the bot's own decisions split into static / mid / dynamic boards (each decision counted once, the bot's range as it is then)
  const dd = d.filter(x => x.dy);
  if (dd.length) {
    const cnt = { static: 0, mid: 0, dynamic: 0 }; for (const x of dd) cnt[x.dy]++;
    const ds = dd.map(x => x.ds).sort((a, b) => a - b), q = f => ds[Math.min(ds.length - 1, Math.floor(f * ds.length))];
    res.dyn = { n: dd.length, static: cnt.static / dd.length, mid: cnt.mid / dd.length, dynamic: cnt.dynamic / dd.length, q10: q(0.1), q50: q(0.5), q90: q(0.9) };
    console.log(`${ST[st].padEnd(5)} board (Step2)  n=${String(dd.length).padStart(5)}  static ${pct(res.dyn.static)} mid ${pct(res.dyn.mid)} dynamic ${pct(res.dyn.dynamic)}  | score 10/50/90%: ${pct(q(0.1))} ${pct(q(0.5))} ${pct(q(0.9))}`);
    // by class, the first-to-act spots: how often the bot bets and the mean size (§4's table: static -> small, high frequency; dynamic -> big or check)
    res.dynBet = {};
    for (const k of ['static', 'mid', 'dynamic']) {
      const o = dd.filter(x => x.dy === k && x.toCall === 0); if (!o.length) continue; const b = o.filter(x => x.act === 'raise');
      res.dynBet[k] = { n: o.length, freq: b.length / o.length, size: b.reduce((a, x) => a + x.to / x.pot, 0) / (b.length || 1) };
    }
    console.log('      first to act, by board: ' + Object.entries(res.dynBet).map(([k, v]) => `${k} n=${v.n} bets ${pct(v.freq)} size ${pct(v.size)}`).join(' | '));
    // the c-bet in position (§4's table is for it: static 25-33% at a high frequency, dynamic 50-75% or more checks)
    res.dynCbetIP = {};
    for (const k of ['static', 'mid', 'dynamic']) {
      const o = dd.filter(x => x.dy === k && x.k === 'cbet' && x.ip); if (!o.length) continue; const b = o.filter(x => x.act === 'raise');
      res.dynCbetIP[k] = { n: o.length, freq: b.length / o.length, size: b.reduce((a, x) => a + x.to / x.pot, 0) / (b.length || 1) };
    }
    if (Object.keys(res.dynCbetIP).length) console.log('      c-bet in position, by board: ' + Object.entries(res.dynCbetIP).map(([k, v]) => `${k} n=${v.n} bets ${pct(v.freq)} size ${pct(v.size)}`).join(' | '));
  }
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
  // §3 by size: the bets of each size band, by bucket: what they are (the bettor's own bucket), and what the other reads them as (the bettor's
  // range before the bet x §3's row of that size, this checkout's params). river: the read's air (B5) against B / (P + 2B)
  const betsMb = bets.filter(x => x.mb && x.b);
  if (betsMb.length) {
    const um = (await import('../bot/spec/params.js')).default.DEFAULTS.equilibrium.updateMult;
    const f5 = a => a.map(x => (100 * x).toFixed(0).padStart(3) + '%').join(' ');
    res.betRead = [];
    for (const band of BANDS) {
      const g = betsMb.filter(x => x.to / x.pot >= band[0] && x.to / x.pot < band[1]); if (!g.length) continue;
      const act = [0, 0, 0, 0, 0], pre = [0, 0, 0, 0, 0], read = [0, 0, 0, 0, 0];
      let th = 0;
      for (const x of g) {
        const sz = x.to / x.pot, m = RG.betMult(um, sz); act[x.b - 1]++; th += sz / (1 + 2 * sz);
        const r = x.mb.map((p, b) => p * m[b]), t = r.reduce((a, y) => a + y, 0) || 1;
        for (let b = 0; b < 5; b++) { pre[b] += x.mb[b]; read[b] += r[b] / t; }
      }
      const n = g.length, row = { band: bandName(band), n, actual: act.map(y => y / n), prior: pre.map(y => y / n), read: read.map(y => y / n), theory: th / n };
      res.betRead.push(row);
      console.log(`      bets ${row.band.padEnd(8)} n=${String(n).padStart(5)}  by bucket B1..B5: actual ${f5(row.actual)} | read ${f5(row.read)} | range before ${f5(row.prior)}` + (st === 3 ? `  | read air ${pct(row.read[4])} (theory ${pct(row.theory)})` : ''));
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
if (V === 'spec') {
  const rv = out.streets.river || {}, big = (rv.riverBluff || []).filter(x => x.lo >= 0.8);
  const n = big.reduce((a, x) => a + x.n, 0), bl = big.reduce((a, x) => a + x.n * x.share, 0) / (n || 1);
  const fails = [];
  if (!(bl >= 0.15)) fails.push(`river bets of 0.8x pot or more: ${(100 * bl).toFixed(1)}% bluffs (want 15%+)`);
  if (rv.facingBet && rv.facingBet.fold > rv.facingBet.alpha + 0.10) fails.push(`river: folds ${(100 * rv.facingBet.fold).toFixed(1)}% to a bet, bound ${(100 * rv.facingBet.alpha).toFixed(1)}% (want within 10pt)`);
  for (const f of fails) console.log('FAIL', f);
  console.log(fails.length ? `${fails.length} failed` : 'spec-theory: all passed');
  process.exitCode = fails.length ? 1 : 0;
}
console.log('RESULT ' + JSON.stringify(out));
