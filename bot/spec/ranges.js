/* Spec bot (docs/postflop_spec.md §3 Step1, §7 buckets): every live player's range as everyone sees it, kept through the hand.
   startStreet: card removal (the board), then every combo of every range gets its equity E against the other players' ranges (their sum when
   there are more than one, §10), before the river its D and V (§7), and its bucket B1-B5. These buckets stay for the street: an action is
   always read with the buckets of the street it was taken on (§3).
   apply: an action multiplies the actor's combos by the multiplier of their bucket (§3's table), never below floor x the combo's weight at the flop.
   The bot's own hole cards are not removed here: "the range as the opponent sees it" keeps them, and the equity engine leaves out, for each
   combo, the opponent combos that share a card with it.
   Works in the browser (window.SpecRanges) and in node (require). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./cards.js') : root.SpecCards, node ? require('./equity.js') : root.SpecEquity);
  if (node) module.exports = api; else root.SpecRanges = api;
})(typeof self !== 'undefined' ? self : this, function (C, E) {
  'use strict';
  const { NC, CA, CB } = C;

  function bucketOf(e, d, river, b) {   // §7: 1..5 (0 = not live)
    if (!(e >= 0)) return 0;
    if (e >= b.b1) return 1;
    if (e >= b.b2) return 2;
    if (!river && e < b.drawMaxE && d >= b.devD) return 4;   // B3 and B4 overlap (E 40-50% with D >= 20%): B4 (§7)
    if (e >= b.b3) return 3;
    return 5;
  }

  class HandRanges {
    constructor(params) { this.prm = params; this.W = {}; this.W0 = {}; this.street = -1; this.cache = {}; this.board = []; }
    setPre(seat, W) { this.W[seat] = Float32Array.from(W); }
    seats() { return Object.keys(this.W).map(Number); }
    drop(seat) { delete this.W[seat]; delete this.cache[seat]; }
    /* the sum of the other players' ranges, each scaled to a total of 1 (one opponent: its range as it is, scaled) */
    others(seat) {
      const out = new Float32Array(NC);
      for (const s of this.seats()) { if (s === seat) continue; const W = this.W[s]; let t = 0; for (let i = 0; i < NC; i++) t += W[i]; if (t > 0) for (let i = 0; i < NC; i++) out[i] += W[i] / t; }
      return out;
    }
    /* street: 1 flop .. 3 river. opts: {perCard, rng} (the flop's sampled mode, docs/decisions.md) */
    startStreet(street, board, opts) {
      opts = opts || {};
      const eq = this.prm.equilibrium, dead = new Uint8Array(52); board.forEach(c => dead[c] = 1);
      for (const s of this.seats()) { const W = this.W[s]; for (let i = 0; i < NC; i++) if (dead[CA[i]] || dead[CB[i]]) W[i] = 0; }
      for (const s of this.seats()) if (!this.W0[s]) this.W0[s] = Float32Array.from(this.W[s]);   // the weights the floor is measured from: at the first street the ranges are set up (the flop)
      this.street = street; this.board = board.slice();
      const only = new Uint8Array(NC);
      for (const s of this.seats()) { const W = this.W[s]; for (let i = 0; i < NC; i++) if (W[i] > 0) only[i] = 1; }
      const t0 = Date.now();
      const table = new E.StreetTable(board, only, street === 1 ? opts.perCard : null, opts.rng);
      const river = street === 3;
      this.cache = {};
      for (const s of this.seats()) {
        const sw = table.sweep(this.others(s), !river);
        const W = this.W[s], D = new Float32Array(NC), V = new Float32Array(NC), bucket = new Uint8Array(NC);
        for (let i = 0; i < NC; i++) {
          if (!(W[i] > 0)) continue;
          if (!river) { const dv = E.devVul(sw, i, eq.devHi, eq.vulLo); D[i] = dv.D; V[i] = dv.V; }
          bucket[i] = bucketOf(sw.eq[i], D[i], river, { b1: eq.bucket.b1, b2: eq.bucket.b2, b3: eq.bucket.b3, drawMaxE: eq.bucket.drawMaxE, devD: eq.devD });
        }
        this.cache[s] = { eq: sw.eq, D, V, bucket, nextWin: sw.nextWin, nextTot: sw.nextTot };
      }
      this.table = table; this.exact = table.exact; this.ms = Date.now() - t0;
    }
    /* the share of a range's weight in each bucket [B1..B5] */
    bucketShares(seat) {
      const W = this.W[seat], b = this.cache[seat] && this.cache[seat].bucket, out = [0, 0, 0, 0, 0];
      if (!W || !b) return out;
      let t = 0; for (let i = 0; i < NC; i++) { const w = W[i]; if (w > 0 && b[i]) { out[b[i] - 1] += w; t += w; } }
      return t > 0 ? out.map(x => x / t) : out;
    }
    /* an action of seat: mult = [B1..B5] (the row of §3's table, after the phase-2 hook). returns the trace's part: {before, after, mult} */
    apply(seat, mult) {
      const W = this.W[seat], W0 = this.W0[seat], c = this.cache[seat];
      if (!W || !c) return null;
      const before = this.bucketShares(seat), floor = this.prm.design.weightFloor;
      for (let i = 0; i < NC; i++) {
        if (!(W[i] > 0) || !c.bucket[i]) continue;
        W[i] = Math.max(W[i] * mult[c.bucket[i] - 1], floor * (W0 ? W0[i] : W[i]));
      }
      return { before, after: this.bucketShares(seat), mult: mult.slice() };
    }
  }
  return { bucketOf, HandRanges };
});
