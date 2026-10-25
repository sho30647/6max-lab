/* Spec bot (docs/postflop_spec.md): every number of the spec, in one place, by the optimisation classes of §11.
   equilibrium (①): fitted to the solver in phase 1. exploit (②): phase 2 only, phase-1 code never reads it. design (③): speed and safety.
   hooks: where phase 2 (appendix A) plugs in; in phase 1 they return their input unchanged.
   A player can carry its own copy (player.specParams, e.g. from the bench); SpecParams.merge(base, changes) builds one.
   Works in the browser (window.SpecParams) and in node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecParams = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const B = (b1, b2, b3, b4, b5) => [b1, b2, b3, b4, b5];   // per bucket B1 (nuts) .. B5 (air)
  const DEFAULTS = {
    equilibrium: {
      // §3 Step1: the multiplier of each bucket when a player takes the action
      updateMult: {
        callBet: B(0.5, 1.0, 0.9, 0.9, 0.1),
        raiseBet: B(1.0, 0.1, 0.02, 0.2, 0.05),    // was (1.0, 0.4, 0.05, 0.4, 0.1): set to how the bot itself raises (2026-10-26 night, docs/decisions.md)
        checkAggr: B(0.3, 0.6, 1.0, 0.6, 0.7),     // the aggressor checks
        checkBackIP: B(0.3, 0.6, 1.0, 0.6, 0.7),   // the caller in position checks back (its own copy, §3)
        checkOOPCaller: B(1, 1, 1, 1, 1),          // the caller out of position checks: no narrowing (§3)
        betSmall: B(0.6, 1.0, 0.6, 0.7, 0.5),
        betBig: B(1.0, 0.7, 0.1, 0.6, 0.4),
        bigBet: 0.75                               // a bet of this share of the pot or more is "big"
      },
      // §4 Step2
      staticDynamic: [0.30, 0.60], dynMove: 0.05,  // the share of next cards that move the range's mean equity by dynMove or more
      // §5 Step3
      raNaThresh: 0.05, oopRaAdj: 0.03, nutEq: 0.80, midBand: [0.40, 0.60],
      // §6 Step4: the 9 points of the bilinear interpolation, [RA][NA] with RA and NA at -5 / 0 / +5 pt; size as a share of the pot
      nodeGrid: {
        freq: [[0.10, 0.10, 0.30], [0.10, 0.50, 0.30], [0.75, 0.75, 0.75]],      // rows: RA -5, 0, +5; columns: NA -5, 0, +5
        size: [[0.63, 0.63, 1.13], [0.63, 0.42, 1.13], [0.29, 0.29, null]],      // null: the static / dynamic point below
        sizeTopStatic: 0.29, sizeTopDynamic: 0.63
      },
      sizeLadder: [0.25, 0.33, 0.50, 0.75, 1.00, 1.25, 1.50],
      oopSlowB1: 0.20, stepFreq: 0.15,             // §6 corrections: one "step" of frequency; the B1 share an out-of-position bettor keeps in its check range
      sprLow: 2, sprHigh: 6,
      // §7 Step5
      bucket: { b1: 0.80, b2: 0.60, b3: 0.40, drawMaxE: 0.60 }, devD: 0.14,   // B4: E < 60% and D >= 14%: 7 good cards of 47 or 46 (an open-ended straight draw with one dirty out) in, 6 (two overcards: 6/46 = 13.0%) out; docs/decisions.md
      drawJump: 0.20,   // the draw flag: a next card counts only when it takes the hand to devHi or more AND at least 20pt up (docs/decisions.md 2026-10-27)
      devHi: 0.80, vulLo: 0.50,
      // §8 Step6
      realize: { ip: 1.0, oop: 0.85, river: 1.0 },
      reactSeesBet: true,                          // §8 2: the others react to the bot's range as narrowed by the bet (§3), not as it was before it (docs/decisions.md)
      tau: 0.02, delta0: 0, deltaMax: 0.15, marginReact: 0.05,   // deltaMax: the frequency shift is at most 15% of the pot (docs/decisions.md)
      raiseRate: { flop: 0.10, turn: 0.08, river: 0.06 },
      eqDenial: { foldEq: 0.20 }, minSizeShare: 0.10,
      // §9 Step7
      marginCall: { flopTurn: 0.03, river: 0 }, mdfSlack: 0, mdfBorder: 0.10,   // mdfSlack: 0.10 -> 0 (2026-10-26 night, docs/decisions.md); mdfBorder: the MDF guard calls again only down to the price - 10pt (docs/decisions.md)
      raiseF: { flop: 0.75, turn: 1.0, river: 1.0 },
      // §10
      multiwayBluff: 0.3, multiwayValueEc: 0.60
    },
    exploit: {   // ② appendix A, phase 2: kept here, never read in phase 1
      raiseBluffWeight: 0.5, poolK: 30
    },
    design: {    // ③
      weightFloor: 0.02, freqTol: 0.10, timeBudgetMs: 500, mcIters: 5000, exploitClamp: [0.2, 2.0],
      equity: { exactMaxMs: 400, splitMaxMs: 500, splitPerCard: 3, splitPerCardMin: 2, probeRunouts: 50 },   // docs/decisions.md
      traceKeepHands: 50
    },
    // §12: the words that turn a number into a judgement (the bounds are the spec's)
    explainWords: {
      ra: [[0.05, 'レンジ全体でこちらが有利。高い頻度で打てる'], [-0.05, 'レンジ全体ではほぼ互角'], [-Infinity, 'レンジ全体で相手が有利。打つ頻度を下げる']],
      na: [[0.05, '最強クラスの手をこちらが多く持つ。大きく打てる'], [-0.05, '最強クラスの手の量はほぼ互角'], [-Infinity, '最強クラスの手は相手のほうが多い。大きく打つと危険']],
      dyn: { static: '次のカードで形勢がほとんど変わらない', mid: '次のカードで形勢がある程度変わりうる', dynamic: '次のカードで形勢が大きく変わりうる' },
      bucket: ['', '相手のレンジのほぼ全体に勝っている', '相手のレンジの多くに勝っている', '勝ち負けがほぼ半々', '今は負けているが、強くなる見込みがある', '今は負けており、強くなる見込みも小さい'],
      D: [[0.20, 'この先強くなる見込みは大きい'], [0.10, 'この先強くなる見込みは多少ある'], [-Infinity, 'この先強くなる見込みは小さい']],
      V: [[0.30, '逆転される心配が大きく、今のうちにポットを取る価値が高い'], [0.15, '逆転される心配はある程度ある'], [-Infinity, '逆転される心配は小さい']],
      Ec: [[0.50, 'コールしてくる手にも勝っている（ベットがバリューになる）'], [-Infinity, 'コールしてくる手には負けている（打つと強い手にだけコールされる）']],
      delta: { pure: '迷う余地がないので毎回この行動', mixed: 'ほぼ互角なので確率で混ぜる' }
    },
    hooks: {
      updateMult: (ctx, mult) => mult,     // Step1
      reaction: (ctx, react) => react,     // Step6
      bluffWeight: (ctx, w) => w           // Step7
    }
  };
  function merge(base, changes) {   // a deep copy of base with changes laid over it (functions are kept as they are)
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in changes || {}) {
      const v = changes[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
    }
    return out;
  }
  return { DEFAULTS, merge };
});
