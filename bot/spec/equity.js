/* Spec bot (docs/postflop_spec.md §0): the equity engine. Numbers only, no poker decisions.
   StreetTable(board): every way the board can run out from here (flop: 1,081 turn+river pairs, turn: 46 rivers, river: 1), with every live combo's
   hand value on each runout, ranked once. sweep(W) then gives, for every combo at once, its exact equity against the range W
   (card removal included: the combos of W that share a card with it or with the runout do not count), and, before the river,
   its equity after each next card (the input of D and V, docs/postflop_spec.md §7). A sweep re-uses the ranking, so the equity against
   another range (a calling range, a raising range) costs no new hand evaluation.
   handVsRanges: Monte Carlo equity of one hand against one or more ranges (the multiway pots, §10).
   Works in the browser (window.SpecEquity) and in node (require). */
(function (root, factory) {
  const C = typeof module === 'object' && module.exports ? require('./cards.js') : root.SpecCards;
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecEquity = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { NC, CA, CB, evalHand, boardInfo, eval7 } = C;

  class StreetTable {
    /* only: optional Uint8Array(1326), the combos to rank (those of the ranges that will be swept); default all.
       perCard (flop only): rank a sample of the runouts instead of all 1,081: for every turn card, perCard random river cards (so every next card
       is covered and D / V stay usable). The equities are then estimates; without it they are exact. rng: () => [0, 1) */
    constructor(board, only, perCard, rng) {
      this.board = board.slice();
      const dead = new Uint8Array(52); board.forEach(c => dead[c] = 1);
      const rest = []; for (let c = 0; c < 52; c++) if (!dead[c]) rest.push(c);
      const need = 5 - board.length;
      let runouts = [];
      if (need === 0) runouts.push([]);
      else if (need === 1) for (const x of rest) runouts.push([x]);
      else if (perCard) {
        rng = rng || Math.random; const seen = new Set();
        for (const x of rest) {
          const others = rest.filter(y => y !== x);
          for (let k = 0; k < perCard && others.length; k++) { const y = others.splice((rng() * others.length) | 0, 1)[0]; const key = Math.min(x, y) * 52 + Math.max(x, y); if (!seen.has(key)) { seen.add(key); runouts.push([Math.min(x, y), Math.max(x, y)]); } }
        }
      }
      else for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) runouts.push([rest[i], rest[j]]);
      this.need = need; this.runouts = runouts; this.exact = !(need === 2 && perCard);
      // per runout: the live combos sorted by hand value (order), and where each run of equal values ends (grpEnd[k] = index after the group of position k)
      this.order = []; this.grpEnd = [];
      const keys = new Float64Array(NC), vals = new Int32Array(NC);
      for (const ro of runouts) {
        const d2 = dead.slice(); ro.forEach(c => d2[c] = 1);
        const BI = boardInfo(board.concat(ro));
        let n = 0;
        for (let i = 0; i < NC; i++) {
          if ((only && !only[i]) || d2[CA[i]] || d2[CB[i]]) continue;
          const v = eval7(CA[i], CB[i], BI); vals[i] = v; keys[n++] = v * 2048 + i;
        }
        const ks = keys.subarray(0, n).slice().sort();
        const ord = new Int16Array(n), end = new Int16Array(n);
        for (let k = 0; k < n; k++) ord[k] = ks[k] % 2048;
        for (let k = n - 1; k >= 0; k--) end[k] = (k + 1 < n && vals[ord[k + 1]] === vals[ord[k]]) ? end[k + 1] : k + 1;
        this.order.push(ord); this.grpEnd.push(end);
      }
    }
    /* the equity of every combo against the range W (Float32Array(1326)); withNext: also by the next card (flop / turn only)
       W must be zero outside the combos the table ranks. returns {eq: Float32Array(1326) (NaN for a combo that is not live), nextWin, nextTot: Float64Array(1326*52) (win and weight after each next card)} */
    sweep(W, withNext) {
      const win = new Float64Array(NC), tot = new Float64Array(NC);
      const nx = withNext && this.need > 0;
      const nextWin = nx ? new Float64Array(NC * 52) : null, nextTot = nx ? new Float64Array(NC * 52) : null;
      const below = new Float64Array(52), grp = new Float64Array(52), all = new Float64Array(52);
      for (let r = 0; r < this.runouts.length; r++) {
        const ord = this.order[r], end = this.grpEnd[r], n = ord.length, ro = this.runouts[r];
        let T = 0; all.fill(0);
        for (let k = 0; k < n; k++) { const i = ord[k], w = W[i]; if (w > 0) { T += w; all[CA[i]] += w; all[CB[i]] += w; } }
        if (T <= 0) continue;
        below.fill(0); let belowT = 0;
        for (let k = 0; k < n;) {
          const e = end[k];
          let gT = 0;
          for (let q = k; q < e; q++) { const i = ord[q], w = W[i]; if (w > 0) { gT += w; grp[CA[i]] += w; grp[CB[i]] += w; } }
          for (let q = k; q < e; q++) {
            const i = ord[q], a = CA[i], b = CB[i], wi = W[i];
            const t = T - all[a] - all[b] + wi; if (t <= 0) continue;
            const w = belowT - below[a] - below[b] + 0.5 * (gT - grp[a] - grp[b] + wi);
            win[i] += w; tot[i] += t;
            if (nx) {
              if (this.need === 1) { const x = i * 52 + ro[0]; nextWin[x] += w; nextTot[x] += t; }
              else { const x = i * 52 + ro[0], y = i * 52 + ro[1]; nextWin[x] += w; nextTot[x] += t; nextWin[y] += w; nextTot[y] += t; }
            }
          }
          for (let q = k; q < e; q++) { const i = ord[q]; grp[CA[i]] = 0; grp[CB[i]] = 0; const w = W[i]; if (w > 0) { below[CA[i]] += w; below[CB[i]] += w; } }
          belowT += gT; k = e;
        }
      }
      const eq = new Float32Array(NC);
      for (let i = 0; i < NC; i++) eq[i] = tot[i] > 0 ? win[i] / tot[i] : NaN;
      return { eq, nextWin, nextTot };
    }
  }

  /* one hand's exact equity against the range W, and after each next card (flop / turn): every runout x every combo of W, no ranking of the range.
     returns {eq, nextEq: Float32Array(52) (NaN for a card that cannot come)} */
  function handExact(hole, board, W) {
    const dead = new Uint8Array(52); hole.forEach(c => dead[c] = 1); board.forEach(c => dead[c] = 1);
    const rest = []; for (let c = 0; c < 52; c++) if (!dead[c]) rest.push(c);
    const idx = []; for (let i = 0; i < NC; i++) if (W[i] > 0 && !dead[CA[i]] && !dead[CB[i]]) idx.push(i);
    const need = 5 - board.length, nW = new Float64Array(52), nT = new Float64Array(52);
    let win = 0, tot = 0;
    const one = ro => {
      const BI = boardInfo(board.concat(ro)), my = eval7(hole[0], hole[1], BI);
      let w = 0, t = 0;
      for (const i of idx) { const a = CA[i], b = CB[i]; if (ro.includes(a) || ro.includes(b)) continue; const x = W[i], v = eval7(a, b, BI); t += x; if (v < my) w += x; else if (v === my) w += 0.5 * x; }
      win += w; tot += t; for (const c of ro) { nW[c] += w; nT[c] += t; }
    };
    if (need === 0) one([]);
    else if (need === 1) for (const x of rest) one([x]);
    else for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) one([rest[i], rest[j]]);
    const nextEq = new Float32Array(52).fill(NaN);
    if (need > 0) for (let c = 0; c < 52; c++) if (nT[c] > 0) nextEq[c] = nW[c] / nT[c];
    return { eq: tot > 0 ? win / tot : NaN, nextEq };
  }
  function devVulOf(nextEq, dHi, vLo) {
    let n = 0, d = 0, v = 0;
    for (let c = 0; c < 52; c++) { const e = nextEq[c]; if (isNaN(e)) continue; n++; if (e >= dHi) d++; if (e < vLo) v++; }
    return n ? { D: d / n, V: v / n } : { D: 0, V: 0 };
  }

  /* D and V of a combo from a sweep with withNext (docs/postflop_spec.md §7): the share of the next cards after which its equity is >= dHi (D) / < vLo (V) */
  function devVul(sw, i, dHi, vLo) {
    let n = 0, d = 0, v = 0;
    for (let c = 0; c < 52; c++) { const t = sw.nextTot[i * 52 + c]; if (!(t > 0)) continue; const e = sw.nextWin[i * 52 + c] / t; n++; if (e >= dHi) d++; if (e < vLo) v++; }
    return n ? { D: d / n, V: v / n } : { D: 0, V: 0 };
  }

  /* Monte Carlo: one hand against one or more ranges at once (it wins only by beating every one of them). rng: () => [0, 1) */
  function handVsRanges(hole, board, ranges, iters, rng) {
    rng = rng || Math.random;
    const dead = new Uint8Array(52); hole.forEach(c => dead[c] = 1); board.forEach(c => dead[c] = 1);
    const lists = ranges.map(W => { const idx = [], cum = []; let t = 0; for (let i = 0; i < NC; i++) { const w = W[i]; if (!(w > 0) || dead[CA[i]] || dead[CB[i]]) continue; t += w; idx.push(i); cum.push(t); } return { idx, cum, t }; });
    if (lists.some(L => L.t <= 0)) return NaN;
    const avail = []; for (let c = 0; c < 52; c++) if (!dead[c]) avail.push(c);
    const used = new Uint8Array(52), mine = new Array(7), theirs = new Array(7);
    for (let k = 0; k < board.length; k++) { mine[k + 2] = theirs[k + 2] = board[k]; }
    mine[0] = hole[0]; mine[1] = hole[1];
    let win = 0, done = 0;
    for (let it = 0; it < iters; it++) {
      used.fill(0); const hands = []; let ok = true;
      for (const L of lists) {
        let got = -1;
        for (let t = 0; t < 30 && got < 0; t++) {
          const x = rng() * L.t; let lo = 0, hi = L.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (L.cum[m] < x) lo = m + 1; else hi = m; }
          const i = L.idx[lo]; if (!used[CA[i]] && !used[CB[i]]) got = i;
        }
        if (got < 0) { ok = false; break; }
        used[CA[got]] = used[CB[got]] = 1; hands.push(got);
      }
      if (!ok) continue;
      let k = board.length;
      while (k < 5) { const c = avail[(rng() * avail.length) | 0]; if (!used[c]) { used[c] = 1; mine[k + 2] = theirs[k + 2] = c; k++; } }
      const my = evalHand(mine); let best = true, ties = 0;
      for (const h of hands) { theirs[0] = CA[h]; theirs[1] = CB[h]; const v = evalHand(theirs); if (v > my) { best = false; break; } if (v === my) ties++; }
      if (best) win += 1 / (ties + 1);
      done++;
    }
    return done ? win / done : NaN;
  }

  return { StreetTable, devVul, handExact, devVulOf, handVsRanges };
});
