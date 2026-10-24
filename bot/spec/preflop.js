/* Spec bot (docs/postflop_spec.md §3 step 1): the preflop ranges by line, as combo weights.
   The game's charts give, for each preflop spot, the frequency of each of the 169 hand classes for raise (r), call (c) and all-in (j).
   A player's range at the flop is the product, over its preflop actions, of the frequency of the action it took in the spot it was in
   (BTN open then a call of a 3-bet: open.BTN.r x vs3bet.BTNvsBB.c), spread evenly over the combos of each class.
   The game hands the spot of every preflop action to the bot (SpecBot.onAction: info.pre), so the bot reads the same charts the bots play,
   the shared (admin-edited) tables and the built-in ones alike.
   Works in the browser (window.SpecPreflop) and in node (require). */
(function (root, factory) {
  const C = typeof module === 'object' && module.exports ? require('./cards.js') : root.SpecCards;
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecPreflop = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  const { NC, CLASS } = C;
  const get = (m, k) => !m ? 0 : typeof m.get === 'function' ? (m.get(k) || 0) : (+(m[k] || 0));   // a Map (the game's charts) or a plain object

  /* the frequency of one action in one spot, per class. spot: {r, c, j} (Maps or objects, class -> frequency), act: 'raise' | 'bet' | 'call' | 'check' */
  function actionFreq(spot, act, k) {
    if (act === 'raise' || act === 'bet') return Math.min(1, get(spot.r, k) + get(spot.j, k));
    if (act === 'call') return get(spot.c, k);
    if (act === 'check') return Math.max(0, 1 - get(spot.r, k) - get(spot.j, k));   // the big blind's option: what it does not raise
    return 0;
  }
  /* a player's range from its preflop actions: [{spot, act}]; returns Float32Array(1326) */
  function rangeOf(acts) {
    const byClass = new Map();
    for (let i = 0; i < NC; i++) {
      const k = CLASS[i]; let w = byClass.get(k);
      if (w === undefined) { w = 1; for (const a of acts) { if (!a.spot) continue; w *= actionFreq(a.spot, a.act, k); if (w <= 0) break; } byClass.set(k, w); }
    }
    const W = new Float32Array(NC);
    for (let i = 0; i < NC; i++) W[i] = byClass.get(CLASS[i]);
    return W;
  }
  /* the weight of each class in a range (for the trace: how much of a class the opponent's line keeps), as a share of the class's combos */
  function classShare(W, k) {
    let s = 0, n = 0;
    for (let i = 0; i < NC; i++) if (CLASS[i] === k) { s += W[i]; n++; }
    return n ? s / n : 0;
  }
  return { actionFreq, rangeOf, classShare };
});
