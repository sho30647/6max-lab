/* Spec bot (docs/postflop_spec.md): cards, combos and the hand evaluator.
   Cards are numbered as in index.html: 0-51, rank = c >> 2 (0 = deuce ... 12 = ace), suit = c & 3.
   Combos are numbered 0-1325 in the order of index.html's ALL (a < b, a outer), so a range is a Float32Array(1326) that the game and this bot share.
   Works in the browser (window.SpecCards) and in node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecCards = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RANKS = '23456789TJQKA', SUITS = 'shdc';
  const NC = 1326;
  const CA = new Uint8Array(NC), CB = new Uint8Array(NC);   // the two cards of each combo
  const IDX = new Int16Array(52 * 52).fill(-1);             // (a, b) -> combo number, both orders
  { let i = 0; for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) { CA[i] = a; CB[i] = b; IDX[a * 52 + b] = IDX[b * 52 + a] = i; i++; } }
  const comboOf = (a, b) => IDX[a * 52 + b];
  const cardStr = c => RANKS[c >> 2] + SUITS[c & 3];
  const parseCard = s => RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);
  const parseCards = s => (s.match(/../g) || []).map(parseCard);
  function classKey(a, b) {   // the 169 hand classes, as the game's charts name them ("AKs", "T9o", "77")
    let r1 = a >> 2, r2 = b >> 2; if (r2 > r1) { const t = r1; r1 = r2; r2 = t; }
    if (r1 === r2) return RANKS[r1] + RANKS[r2];
    return RANKS[r1] + RANKS[r2] + ((a & 3) === (b & 3) ? 's' : 'o');
  }
  const CLASS = Array.from({ length: NC }, (_, i) => classKey(CA[i], CB[i]));

  /* the 5-7 card evaluator: a copy of index.html's evalHand (the same numbers, so the game and the bot rank hands alike) */
  function straightHigh(m) {
    for (let h = 12; h >= 4; h--) { const need = 0x1F << (h - 4); if ((m & need) === need) return h; }
    if ((m & 0x100F) === 0x100F) return 3;
    return -1;
  }
  const rc = new Int8Array(13);
  function evalHand(cards) {
    rc.fill(0); const sc = [0, 0, 0, 0], sm = [0, 0, 0, 0]; let mask = 0;
    for (let i = 0; i < cards.length; i++) { const c = cards[i], r = c >> 2, s = c & 3; rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r; }
    let fs = -1; for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) { const sh = straightHigh(sm[fs]); if (sh >= 0) return (8 << 20) | (sh << 16); }
    let quad = -1; const trips = [], pairs = [], singles = [];
    for (let r = 12; r >= 0; r--) { const n = rc[r]; if (n === 4) quad = r; else if (n === 3) trips.push(r); else if (n === 2) pairs.push(r); else if (n === 1) singles.push(r); }
    if (quad >= 0) { let k = 0; for (let r = 12; r >= 0; r--) if (r !== quad && rc[r] > 0) { k = r; break; } return (7 << 20) | (quad << 16) | (k << 12); }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const t = trips[0]; let p = pairs.length ? pairs[0] : -1; if (trips.length > 1 && trips[1] > p) p = trips[1];
      return (6 << 20) | (t << 16) | (p << 12);
    }
    if (fs >= 0) { let v = 0, n = 0; for (let r = 12; r >= 0 && n < 5; r--) if ((sm[fs] >> r) & 1) { v = (v << 4) | r; n++; } return (5 << 20) | v; }
    const sh = straightHigh(mask); if (sh >= 0) return (4 << 20) | (sh << 16);
    if (trips.length) return (3 << 20) | (trips[0] << 16) | ((singles[0] || 0) << 12) | ((singles[1] || 0) << 8);
    if (pairs.length >= 2) { let k = -1; if (pairs.length > 2) k = pairs[2]; if (singles.length && singles[0] > k) k = singles[0]; return (2 << 20) | (pairs[0] << 16) | (pairs[1] << 12) | ((k < 0 ? 0 : k) << 8); }
    if (pairs.length === 1) return (1 << 20) | (pairs[0] << 16) | ((singles[0] || 0) << 12) | ((singles[1] || 0) << 8) | ((singles[2] || 0) << 4);
    let v = 0; for (let i = 0; i < 5 && i < singles.length; i++) v = (v << 4) | singles[i];
    return v;
  }

  /* flops that are the same up to a change of suits: 1,755 classes. canonFlop gives the class key and the suit map that turns the flop into it */
  const PERMS = [];
  (function perm(a, rest) { if (!rest.length) { PERMS.push(a); return; } rest.forEach((x, i) => perm(a.concat([x]), rest.slice(0, i).concat(rest.slice(i + 1)))); })([], [0, 1, 2, 3]);
  function canonFlop(flop) {
    let best = null, bestMap = null;
    for (const p of PERMS) {
      const m = flop.map(c => (c & ~3) | p[c & 3]).sort((x, y) => y - x);
      const k = m[0] * 2704 + m[1] * 52 + m[2];
      if (best === null || k < best) { best = k; bestMap = p; }
    }
    return { key: best, suitMap: bestMap };
  }
  function allCanonFlops() {   // [{key, cards}] for the 1,755 classes, with how many of the 22,100 flops each one stands for
    const seen = new Map();
    for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) {
      const { key } = canonFlop([a, b, c]); const x = seen.get(key);
      if (x) x.n++; else seen.set(key, { key, cards: [Math.floor(key / 2704), Math.floor(key / 52) % 52, key % 52], n: 1 });
    }
    return [...seen.values()];
  }

  /* the same numbers as evalHand for exactly 7 cards (two hole cards + a 5-card board), without allocating: the inner loop of the equity engine.
     bm / bs / brc: the board's rank mask, suit counts and rank counts, set once per board by boardInfo */
  const frc = new Int8Array(13), fsc = new Int8Array(4), fsm = new Int32Array(4);
  function boardInfo(board) {
    const rcB = new Int8Array(13), sc = new Int8Array(4), sm = new Int32Array(4); let mask = 0;
    for (const c of board) { rcB[c >> 2]++; sc[c & 3]++; sm[c & 3] |= 1 << (c >> 2); mask |= 1 << (c >> 2); }
    return { rc: rcB, sc, sm, mask };
  }
  function eval7(a, b, B) {
    frc.set(B.rc); fsc.set(B.sc); fsm.set(B.sm); let mask = B.mask;
    const ra = a >> 2, sa = a & 3, rb = b >> 2, sb = b & 3;
    frc[ra]++; frc[rb]++; fsc[sa]++; fsc[sb]++; fsm[sa] |= 1 << ra; fsm[sb] |= 1 << rb; mask |= (1 << ra) | (1 << rb);
    let fs = -1; for (let s = 0; s < 4; s++) if (fsc[s] >= 5) fs = s;
    if (fs >= 0) { const sh = straightHigh(fsm[fs]); if (sh >= 0) return (8 << 20) | (sh << 16); }
    let quad = -1, t0 = -1, t1 = -1, p0 = -1, p1 = -1, p2 = -1, s0 = -1, s1 = -1, s2 = -1, s3 = -1, s4 = -1;
    for (let r = 12; r >= 0; r--) {
      const n = frc[r];
      if (n === 4) quad = r;
      else if (n === 3) { if (t0 < 0) t0 = r; else if (t1 < 0) t1 = r; }
      else if (n === 2) { if (p0 < 0) p0 = r; else if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
      else if (n === 1) { if (s0 < 0) s0 = r; else if (s1 < 0) s1 = r; else if (s2 < 0) s2 = r; else if (s3 < 0) s3 = r; else if (s4 < 0) s4 = r; }
    }
    if (quad >= 0) { let k = 0; for (let r = 12; r >= 0; r--) if (r !== quad && frc[r] > 0) { k = r; break; } return (7 << 20) | (quad << 16) | (k << 12); }
    if (t0 >= 0 && (t1 >= 0 || p0 >= 0)) { let p = p0; if (t1 > p) p = t1; return (6 << 20) | (t0 << 16) | (p << 12); }
    if (fs >= 0) { let v = 0, n = 0; const m = fsm[fs]; for (let r = 12; r >= 0 && n < 5; r--) if ((m >> r) & 1) { v = (v << 4) | r; n++; } return (5 << 20) | v; }
    const sh = straightHigh(mask); if (sh >= 0) return (4 << 20) | (sh << 16);
    const z = x => x < 0 ? 0 : x;
    if (t0 >= 0) return (3 << 20) | (t0 << 16) | (z(s0) << 12) | (z(s1) << 8);
    if (p1 >= 0) { let k = p2; if (s0 > k) k = s0; return (2 << 20) | (p0 << 16) | (p1 << 12) | (z(k) << 8); }
    if (p0 >= 0) return (1 << 20) | (p0 << 16) | (z(s0) << 12) | (z(s1) << 8) | (z(s2) << 4);
    return (s0 << 16) | (s1 << 12) | (s2 << 8) | (s3 << 4) | s4;
  }

  return { RANKS, SUITS, NC, CA, CB, comboOf, cardStr, parseCard, parseCards, classKey, CLASS, evalHand, boardInfo, eval7, canonFlop, allCanonFlops };
});
