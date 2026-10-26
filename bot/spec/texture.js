/* Spec bot (docs/postflop_spec.md §4 Step2): the board's texture on five axes, and the class of a new turn / river card.
   The labels explain and check the computed numbers (§4: the final decision follows the equities); the static / dynamic axis is computed
   from the range's equity after each next card (ranges.js gives it).
   Works in the browser (window.SpecTexture) and in node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecTexture = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const rk = c => c >> 2, su = c => c & 3;
  // the ranks of a board as straight positions (the ace also counts as 1)
  function rankSet(board) { const s = new Set(); for (const c of board) { s.add(rk(c) + 2); if (rk(c) === 12) s.add(1); } return s; }
  /* a straight can be made with two hole cards: some 5-rank window holds 3 or more board ranks */
  function straightPossible(board) {
    const s = rankSet(board);
    for (let lo = 1; lo <= 10; lo++) { let n = 0; for (let r = lo; r < lo + 5; r++) if (s.has(r)) n++; if (n >= 3) return true; }
    return false;
  }
  /* §4's five axes. dynScore: the share of the range's top 20% that drops out of it after a next card, averaged over the cards (strategy.js step2; null on the river) */
  function axes(board, dynScore, bounds) {
    const ranks = board.map(rk).sort((a, b) => b - a), top = ranks[0];
    const high = top === 12 ? 'A' : top >= 10 ? 'KQ' : top >= 8 ? 'JT' : '9-';
    // connectedness (§4): a straight is possible with the board's three cards (or two pairs of cards within 2 ranks) -> high; a pair within 4 -> semi
    const u = [...new Set(ranks)], pos = u.flatMap(r => r === 12 ? [14, 1] : [r + 2]);
    let near2 = 0, near4 = 0;
    for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) {
      const a = u[i] + 2, b = u[j] + 2;
      let d = Math.abs(a - b); if (a === 14) d = Math.min(d, Math.abs(1 - b)); if (b === 14) d = Math.min(d, Math.abs(a - 1));
      if (d <= 2) near2++; if (d <= 4) near4++;
    }
    const conn = straightPossible(board) || near2 >= 2 ? 'high' : near4 >= 1 ? 'semi' : 'none';
    const sc = [0, 0, 0, 0]; board.forEach(c => sc[su(c)]++); const mx = Math.max(...sc);
    const suit = mx >= 3 ? 'mono' : mx === 2 ? 'two' : 'rainbow';
    const rc = {}; ranks.forEach(r => rc[r] = (rc[r] || 0) + 1); const mr = Math.max(...Object.values(rc));
    const pair = mr >= 3 ? 'trips' : mr === 2 ? 'pair' : 'none';
    let dyn = null;
    if (dynScore != null) dyn = dynScore < bounds[0] ? 'static' : dynScore <= bounds[1] ? 'mid' : 'dynamic';
    return { high, conn, suit, pair, dyn, dynScore: dynScore == null ? null : Math.round(dynScore * 1000) / 1000, posCount: pos.length };
  }
  /* §4: the class of the newest card (turn / river): every class it fits, the first one is the main one */
  function newCardClass(board) {
    const prev = board.slice(0, -1), c = board[board.length - 1], out = [];
    if (prev.some(x => rk(x) === rk(c))) out.push('pair');
    const sPrev = prev.filter(x => su(x) === su(c)).length;
    if (sPrev === 2) out.push('flush');                                  // the third card of a suit
    if (straightPossible(board) && !straightPossible(prev)) out.push('straight');
    else if (straightPossible(board)) { // the window that holds the most board ranks got fuller
      const s1 = rankSet(prev), s2 = rankSet(board); let best1 = 0, best2 = 0;
      for (let lo = 1; lo <= 10; lo++) { let a = 0, b = 0; for (let r = lo; r < lo + 5; r++) { if (s1.has(r)) a++; if (s2.has(r)) b++; } best1 = Math.max(best1, a); best2 = Math.max(best2, b); }
      if (best2 >= 4 && best1 < 4) out.push('straight');
    }
    if (rk(c) > Math.max(...prev.map(rk))) out.push('over');
    if (!out.length) out.push('blank');
    return out;
  }
  return { axes, newCardClass, straightPossible };
});
