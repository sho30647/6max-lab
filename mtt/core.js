/* MTT core: structure, prize table, virtual clock, the field (other tables) and table balancing.
   No DOM and no poker engine in here: the hero's table is played by the real engine in index.html and reports each hand
   with reportLiveHand(); every other table is advanced by a light chip-conserving simulation.
   Works in the browser (window.MTT) and in node (require / import) so the field can be tested headlessly. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MTT = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- fixed tournament definition (docs/mtt-spec.md §3) ---------- */
  const FIELD = 100, SEATS = 8, START_STACK = 100000, BUY_IN = 50000, POOL = 4500000;
  const LEVELS = [   // [minutes, SB, BB]; the ante is always equal to the BB (big-blind ante)
    [30, 200, 400], [30, 300, 600], [30, 400, 800], [30, 500, 1000],
    [30, 600, 1200], [30, 1000, 1500], [30, 1000, 2000], [30, 1500, 2500],
    [25, 1500, 3000], [25, 2000, 4000], [25, 2500, 5000], [25, 3000, 6000], [25, 4000, 8000], [25, 5000, 10000], [25, 6000, 12000],
    [20, 10000, 15000], [20, 10000, 20000], [20, 15000, 25000], [20, 15000, 30000], [20, 20000, 40000], [20, 30000, 60000],
    [20, 40000, 80000], [20, 50000, 100000], [20, 60000, 120000], [20, 75000, 125000], [20, 100000, 150000],
    [20, 100000, 200000], [20, 125000, 250000], [20, 150000, 300000]
  ].map(([min, sb, bb]) => ({ min, sb, bb, ante: bb }));
  const BREAKS_AFTER = { 4: 10, 8: 10, 15: 5 };   // after level n (1-based): minutes of break
  const PAYOUTS = [1250000, 750000, 500000, 345000, 280000, 225000, 195000, 165000, 130000, 130000, 130000, 100000, 100000, 100000, 100000];
  const PAID = PAYOUTS.length;
  const prizeFor = place => place >= 1 && place <= PAID ? PAYOUTS[place - 1] : 0;

  /* ---------- timeline: level / break windows in virtual seconds ---------- */
  const TIMELINE = (() => {
    const segs = []; let t = 0;
    LEVELS.forEach((L, i) => {
      segs.push({ type: 'level', idx: i, start: t, end: t + L.min * 60 }); t += L.min * 60;
      const b = BREAKS_AFTER[i + 1];
      if (b) { segs.push({ type: 'break', idx: i, start: t, end: t + b * 60 }); t += b * 60; }
    });
    return segs;
  })();
  const LAST = TIMELINE[TIMELINE.length - 1];
  /* what the clock shows at virtual second t */
  function clockAt(t) {
    let seg = TIMELINE.find(s => t < s.end);
    const last = !seg; if (last) seg = LAST;
    const endsAt = last ? Infinity : seg.end;   // the last level repeats
    const idx = seg.type === 'level' ? seg.idx : seg.idx + 1;   // during a break: the level that comes next
    const nextBreak = TIMELINE.find(s => s.type === 'break' && s.start > t);
    return { inBreak: seg.type === 'break', level: idx, lvl: LEVELS[Math.min(idx, LEVELS.length - 1)], endsAt, breakEnd: seg.type === 'break' ? seg.end : null,
      next: LEVELS[Math.min(idx + 1, LEVELS.length - 1)], nextBreakAt: nextBreak ? nextBreak.start : null };
  }

  /* ---------- rng (state can be saved) ---------- */
  function makeRng(seed) { const o = { s: seed >>> 0 };
    o.next = () => { o.s = (o.s + 0x6D2B79F5) | 0; let t = Math.imul(o.s ^ (o.s >>> 15), 1 | o.s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return o; }

  /* ---------- virtual hand duration (spec §4.2) ---------- */
  /* info: {streets: 0..3 (flops seen = 1, turn = 2, river = 3), showdown, allIn}; speed multiplies the seconds (x1 / x2 / x3) */
  function handSeconds(info, rnd, speed) {
    let s = 35; if (info.streets >= 1) s += 20; if (info.streets >= 2) s += 15; if (info.streets >= 3) s += 15; if (info.showdown) s += 10; if (info.allIn) s += 10;
    return s * (0.75 + rnd() * 0.55) * (speed || 1);
  }

  /* ---------- the field ---------- */
  const NAMES_A = ['Haru', 'Ren', 'Yuto', 'Sota', 'Riku', 'Kai', 'Aoi', 'Mio', 'Yui', 'Nao', 'Saki', 'Emi', 'Hiro', 'Taku', 'Jun', 'Kou', 'Rin', 'Mei', 'Ken', 'Dai'];
  const NAMES_B = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Lynx', 'Crow', 'Pike', 'Moth', 'Slate', 'Ember', 'Frost', 'Gale', 'Onyx', 'Sage', 'Vale', 'Flint', 'Reed', 'Dusk', 'Bolt', 'Rook'];
  function makeNames(rnd, n) {
    const all = []; NAMES_A.forEach(a => NAMES_B.forEach(b => all.push(a + b)));
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all.slice(0, n);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normal = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  function makeStyle(rnd) { return { loose: clamp(1 + 0.14 * normal(rnd), 0.7, 1.35), aggr: clamp(1 + 0.18 * normal(rnd), 0.6, 1.5), three: clamp(1 + 0.2 * normal(rnd), 0.6, 1.6) }; }

  /* create a tournament. opts: {seed, speed (1|2|3), heroName, heroLight (the hero's table is simulated like the others — for tests)} */
  function create(opts = {}) {
    const rng = makeRng(opts.seed == null ? (Math.random() * 4294967296) >>> 0 : opts.seed), rnd = rng.next;
    const T = { v: 1, speed: opts.speed || 2, heroLight: !!opts.heroLight, rng, clock: 0, players: [], tables: [], remaining: FIELD, nextPlace: FIELD,
      busts: [], moves: [], handsPlayed: 0, hfh: false, done: false, log: [] };
    const names = makeNames(rnd, FIELD - 1);
    for (let i = 0; i < FIELD; i++) T.players.push({ id: i, name: i === 0 ? (opts.heroName || 'あなた') : names[i - 1], isHero: i === 0, stack: START_STACK, tableId: -1, seat: -1, out: false, place: null,
      style: i === 0 ? { loose: 1, aggr: 1, three: 1 } : makeStyle(rnd) });
    // seat everyone: 100 players on 13 tables (9 of 8 and 4 of 7), random order
    const order = T.players.map(p => p.id); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const nt = Math.ceil(FIELD / SEATS);
    for (let t = 0; t < nt; t++) T.tables.push({ id: t, seats: new Array(SEATS).fill(null), button: Math.floor(rnd() * SEATS), t: 0, live: false });
    order.forEach((pid, k) => { const tb = T.tables[k % nt]; const free = tb.seats.map((v, i) => v == null ? i : -1).filter(i => i >= 0); const s = free[Math.floor(rnd() * free.length)]; tb.seats[s] = pid; T.players[pid].tableId = tb.id; T.players[pid].seat = s; });
    if (!T.heroLight) T.tables[T.players[0].tableId].live = true;
    return T;
  }

  const occ = tb => tb.seats.map((p, i) => p == null ? -1 : i).filter(i => i >= 0);   // occupied seat numbers
  const count = tb => occ(tb).length;
  const liveTables = T => T.tables.filter(t => count(t) > 0);
  const heroTable = T => T.tables[T.players[0].tableId];

  /* ---------- one light hand at a table (chip-conserving) ---------- */
  const SKEW = 0.06;
  const POS_W = { btn: 3, co: 2, other: 1, sb: 1.5, bb: 0.6 };   // who is likely to attack the blinds
  function pickW(items, w, rnd) { let t = 0; const ws = items.map(w); ws.forEach(x => t += x); let r = rnd() * t; for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; }
  /* returns {busted: [{id, start}], seconds} */
  function lightHand(T, tb, lvl) {
    const rnd = T.rng.next, seats = occ(tb), n = seats.length;
    if (n < 2) return { busted: [], seconds: 30 };
    // the button moves to the next occupied seat
    let bi = seats.findIndex(s => s > tb.button); if (bi < 0) bi = 0; tb.button = seats[bi];
    const P = seats.map(s => T.players[tb.seats[s]]), start = P.map(p => p.stack);
    const sbI = n === 2 ? bi : (bi + 1) % n, bbI = n === 2 ? (bi + 1) % 2 : (bi + 2) % n;
    const st = P.map(p => p.stack), c = new Array(n).fill(0);   // chips behind / chips put in this hand
    const ante = Math.min(lvl.ante, st[bbI]); st[bbI] -= ante;
    const sbp = Math.min(lvl.sb, st[sbI]); st[sbI] -= sbp; c[sbI] += sbp;
    const bbp = Math.min(lvl.bb, st[bbI]); st[bbI] -= bbp; c[bbI] += bbp;
    const deadAnte = ante; let info;
    const pot0 = deadAnte + sbp + bbp;
    const posW = i => { const off = (i - bi + n) % n; return n === 2 ? (off === 0 ? 3 : 0.6) : off === 0 ? POS_W.btn : off === n - 1 ? POS_W.co : off === 1 ? POS_W.sb : off === 2 ? POS_W.bb : POS_W.other; };
    const idx = P.map((_, i) => i);
    if (rnd() < (n >= 3 ? 0.5 : 0.35)) {   // the blinds and the ante are won without a fight
      const w = pickW(idx, i => posW(i), rnd);
      st[w] += pot0;   // pot0 includes the winner's own blind (st excludes it), so this returns it
      info = { streets: 0, showdown: false, allIn: false };
    } else {
      const avgT = (st.reduce((x, y) => x + y, 0) + c.reduce((x, y) => x + y, 0)) / n;
      const shortBonus = i => (st[i] + c[i]) < 15 * lvl.bb ? 1.8 : 1;   // short stacks shove more often
      const bigBonus = i => clamp(Math.sqrt((st[i] + c[i]) / avgT), 0.6, 1.8);   // big stacks attack more often
      const A = pickW(idx, i => posW(i) * shortBonus(i) * bigBonus(i) * ((st[i] + c[i]) > 0 ? 1 : 0.0001), rnd);
      const B = pickW(idx.filter(i => i !== A), i => (i === bbI ? 3 : i === sbI ? 2 : 1), rnd);
      const totA = st[A] + c[A], totB = st[B] + c[B], eff = Math.min(totA, totB), effBB = eff / lvl.bb;
      const allIn = rnd() < 0.02 + 0.85 * Math.exp(-effBB / 12);
      let inv = eff;
      if (!allIn) { const mult = Math.exp(Math.log(7) + 0.7 * normal(rnd)); inv = Math.min(eff, Math.max(c[A], c[B], Math.round(mult * lvl.bb))); }
      const allInEff = allIn || inv >= eff;
      let pA = clamp(0.5 + SKEW * Math.log2(Math.max(totA, 1) / Math.max(totB, 1)), 0.3, 0.7);   // the bigger stack applies more pressure
      if (allInEff) { const r = rnd(), fav = r < 0.35 ? 0.5 : r < 0.7 ? 0.55 + rnd() * 0.13 : 0.68 + rnd() * 0.17; pA = rnd() < 0.5 ? fav : 1 - fav; }
      const aWins = rnd() < pA, W = aWins ? A : B, L = aWins ? B : A;
      // pot: everything the others posted (dead) + both players' investments
      let pot = deadAnte; for (let i = 0; i < n; i++) if (i !== A && i !== B) pot += c[i]; pot += 2 * inv;
      st[A] = totA - inv; st[B] = totB - inv; st[W] += pot;
      const s = rnd(); const streets = allInEff ? 1 + (rnd() < 0.5 ? 2 : 0) : 1 + (s < 0.6 ? 1 : 0) + (s < 0.35 ? 1 : 0);
      info = { streets: Math.min(streets, 3), showdown: allInEff || rnd() < 0.5, allIn: allInEff };
    }
    const busted = []; let sum0 = start.reduce((a, b) => a + b, 0), sum1 = 0;
    for (let i = 0; i < n; i++) { P[i].stack = st[i]; sum1 += st[i]; if (st[i] <= 0) { P[i].stack = 0; busted.push({ id: P[i].id, start: start[i] }); } }
    if (sum1 !== sum0) throw new Error('chips not conserved at a light hand: ' + sum0 + ' -> ' + sum1);
    return { busted, seconds: handSeconds(info, rnd, T.speed) };
  }

  /* ---------- busts, places ---------- */
  function placeBusts(T, list, at) {   // list: [{id, start}] busting at the same moment: the bigger starting stack finishes higher
    list.sort((a, b) => a.start - b.start || T.rng.next() - 0.5);
    for (const b of list) {
      const p = T.players[b.id]; if (p.out) continue;
      p.out = true; p.place = T.nextPlace--; p.stack = 0; p.outAt = at;
      const tb = T.tables[p.tableId]; if (tb) tb.seats[p.seat] = null;
      T.remaining--; T.busts.push({ id: p.id, place: p.place, at });
      if (p.isHero) T.heroOut = true;
      if (T.onBust) T.onBust(T, p);
    }
    if (T.remaining === 1) {
      const w = T.players.find(p => !p.out); w.out = true; w.place = 1; w.outAt = at; T.nextPlace = 0; T.done = true;
      const tb = T.tables[w.tableId]; if (tb) tb.seats[w.seat] = null; T.remaining = 0; T.busts.push({ id: w.id, place: 1, at });
    }
  }

  /* ---------- table breaking and balancing (spec §6) ---------- */
  function seatInto(T, pid, tb, reason) {
    const p = T.players[pid], free = tb.seats.map((v, i) => v == null ? i : -1).filter(i => i >= 0);
    const s = free[Math.floor(T.rng.next() * free.length)];
    const from = p.tableId; if (from >= 0 && T.tables[from] && T.tables[from].seats[p.seat] === pid) T.tables[from].seats[p.seat] = null;
    tb.seats[s] = pid; p.tableId = tb.id; p.seat = s;
    T.moves.push({ id: pid, from, to: tb.id, seat: s, reason, at: T.clock });
  }
  /* skipTb: a table whose hand is in progress (the hero's): nobody leaves it, joins it or is moved off it until the hand is over */
  function rebalance(T, skipTb) {
    if (T.done) return;
    const target = Math.ceil(T.remaining / SEATS);
    let tbs = liveTables(T);
    while (tbs.length > target) {   // break the smallest table (ties: the highest number)
      const victim = tbs.filter(t => t !== skipTb).sort((a, b) => count(a) - count(b) || b.id - a.id)[0];
      if (!victim) break;
      const others = tbs.filter(t => t !== victim);
      for (const s of occ(victim)) { const pid = victim.seats[s]; const dest = others.filter(t => t !== skipTb && count(t) < SEATS).sort((a, b) => count(a) - count(b) || a.id - b.id)[0]; if (!dest) break; seatInto(T, pid, dest, 'break'); }
      if (count(victim) > 0) break;   // nowhere to put them: leave it to the next balance
      tbs = liveTables(T);
    }
    for (let guard = 0; guard < 50; guard++) {   // even out: the largest gives one to the smallest while they differ by 2 or more
      tbs = liveTables(T).filter(t => t !== skipTb); if (tbs.length < 2) break;
      const big = tbs.slice().sort((a, b) => count(b) - count(a) || a.id - b.id)[0], small = tbs.slice().sort((a, b) => count(a) - count(b) || a.id - b.id)[0];
      if (count(big) - count(small) < 2) break;
      // the player who would be the big blind next hand moves
      const seats = occ(big); let bi = seats.findIndex(s => s > big.button); if (bi < 0) bi = 0;
      const mover = big.seats[seats[(bi + 2) % seats.length]];
      seatInto(T, mover, small, 'balance');
    }
    // the hero's table is the live one
    if (!T.heroLight && !T.players[0].out && !skipTb) { T.tables.forEach(t => t.live = false); heroTable(T).live = true; }
    // a table that has just received players starts when the others do
    T.tables.forEach(t => { if (count(t) > 0 && t.t < T.clock) t.t = T.clock; });
    T.hfh = T.remaining > PAID && T.remaining <= PAID + liveTables(T).length + 1;
    if (T.onRebalance) T.onRebalance(T);
  }

  /* ---------- advancing the field ---------- */
  const skipBreak = t => { const c = clockAt(t); return c.inBreak ? c.breakEnd : t; };
  /* play every table (except the live one) forward until virtual second `until` */
  function advanceTo(T, until, skip) {
    if (T.hfh) return advanceRound(T, until, skip);
    for (let guard = 0; guard < 100000 && !T.done; guard++) {
      let best = null;
      for (const tb of T.tables) { if (tb === skip || count(tb) < 2) continue; const st = skipBreak(tb.t); if (st <= until && (!best || st < best.st)) best = { tb, st }; }
      if (!best) break;
      const tb = best.tb, c = clockAt(best.st), r = lightHand(T, tb, c.lvl); T.handsPlayed++;
      tb.t = best.st + r.seconds;
      if (r.busted.length) { placeBusts(T, r.busted, tb.t); T.clock = Math.max(T.clock, Math.min(tb.t, until)); rebalance(T, skip); if (T.hfh) return advanceRound(T, until, skip); }
    }
  }
  /* hand for hand: all tables play one hand each, together (the bubble) */
  function advanceRound(T, until, skip) {
    for (let guard = 0; guard < 1000 && !T.done && T.hfh; guard++) {
      const tbs = liveTables(T).filter(t => t !== skip && count(t) >= 2); if (!tbs.length) return;
      const startAt = skipBreak(Math.max(...tbs.map(t => t.t)));
      if (startAt > until) return;
      const c = clockAt(startAt); let dur = 0; const bust = [];
      for (const tb of tbs) { const r = lightHand(T, tb, c.lvl); T.handsPlayed++; dur = Math.max(dur, r.seconds); bust.push(...r.busted); }
      tbs.forEach(t => t.t = startAt + dur);
      T.clock = Math.max(T.clock, Math.min(startAt + dur, until));
      if (bust.length) { placeBusts(T, bust, startAt + dur); rebalance(T, skip); }
    }
  }

  /* run a whole tournament with the hero treated like any other player (tests, simulations) */
  function runAll(T) {
    for (let guard = 0; guard < 200000 && !T.done; guard++) {
      if (T.hfh) { advanceRound(T, Infinity, null); continue; }
      const nextT = Math.min(...T.tables.filter(t => count(t) >= 2).map(t => skipBreak(t.t)));
      if (!isFinite(nextT)) break;
      T.clock = Math.max(T.clock, nextT);
      advanceTo(T, T.clock + 1, null);
    }
    return T;
  }

  /* ---------- the live table (the hero's hand is played by the real engine) ---------- */
  /* the next hand at the hero's table: waits out a break, brings the rest of the field up to the start time and moves the button.
     Returns who sits where, in seat order starting with the hero (that is the engine's seat order), the button's index in that list, and the level. */
  function beginLiveHand(T) {
    const tb = heroTable(T); let st = Math.max(T.clock, tb.t); const c0 = clockAt(st), st0 = st;
    if (c0.inBreak) st = c0.breakEnd;
    advanceTo(T, st, tb); T.clock = Math.max(T.clock, st); tb.t = st;
    const seats = occ(tb), hs = T.players[0].seat, k = seats.indexOf(hs);
    const order = seats.map((_, i) => seats[(k + i) % seats.length]);   // hero first, then clockwise
    let bs = seats.find(x => x > tb.button); if (bs == null) bs = seats[0]; tb.button = bs;
    const c = clockAt(st);
    return { tableId: tb.id, pids: order.map(x => tb.seats[x]), button: order.indexOf(bs), lvl: c.lvl, level: c.level + 1, at: st, breakMin: c0.inBreak ? Math.round((c0.breakEnd - st0) / 60) : 0 };
  }

  /* res: {startStacks:{pid:chips}, endStacks:{pid:chips}, seconds}. Applies the hand, advances the clock and the field. */
  function reportLiveHand(T, res) {
    const tb = heroTable(T), t0 = tb.t, end = Math.max(T.clock, t0) + res.seconds;
    if (T.hfh) {   // hand for hand: the other tables resolve their hand together with this one
      const busts = [];
      for (const k in res.endStacks) { const p = T.players[+k]; p.stack = res.endStacks[k]; if (p.stack <= 0) busts.push({ id: p.id, start: res.startStacks[k] }); }
      const tbs = liveTables(T).filter(t => t !== tb && count(t) >= 2); let dur = res.seconds; const c = clockAt(Math.max(T.clock, t0));
      for (const o of tbs) { const r = lightHand(T, o, c.lvl); T.handsPlayed++; dur = Math.max(dur, r.seconds); busts.push(...r.busted); }
      tbs.forEach(t => t.t = Math.max(T.clock, t0) + dur); tb.t = Math.max(T.clock, t0) + dur; T.clock = tb.t; T.handsPlayed++;
      if (busts.length) { placeBusts(T, busts, T.clock); rebalance(T); }
      return;
    }
    advanceTo(T, end, tb);   // the other tables, up to the moment this hand ends
    const busts = [];
    for (const k in res.endStacks) { const p = T.players[+k]; p.stack = res.endStacks[k]; if (p.stack <= 0) busts.push({ id: p.id, start: res.startStacks[k] }); }
    T.clock = end; tb.t = end; T.handsPlayed++;
    if (busts.length) { placeBusts(T, busts, end); }
    rebalance(T);
  }

  /* ---------- views for the UI ---------- */
  function stats(T) {
    const alive = T.players.filter(p => !p.out), n = alive.length, c = clockAt(T.clock);
    const total = alive.reduce((a, p) => a + p.stack, 0), avg = n ? total / n : 0;
    const ranked = alive.slice().sort((a, b) => b.stack - a.stack), hero = T.players[0];
    return { remaining: n, field: FIELD, avg, avgBB: avg / c.lvl.bb, level: c.level + 1, lvl: c.lvl, next: c.next, inBreak: c.inBreak, toNext: c.endsAt - T.clock,
      toBreak: c.nextBreakAt == null ? null : c.nextBreakAt - T.clock, toITM: Math.max(0, n - PAID), bubble: n === PAID + 1, itm: n <= PAID, tables: liveTables(T).length, hfh: T.hfh,
      heroRank: hero.out ? hero.place : ranked.findIndex(p => p.id === 0) + 1, heroStack: hero.stack, heroBB: hero.stack / c.lvl.bb, ranked };
  }

  return { FIELD, SEATS, START_STACK, BUY_IN, POOL, LEVELS, BREAKS_AFTER, PAYOUTS, PAID, prizeFor, TIMELINE, clockAt, handSeconds, create, lightHand, placeBusts, rebalance,
    advanceTo, runAll, beginLiveHand, reportLiveHand, stats, count, occ, liveTables, heroTable, makeRng };
});
