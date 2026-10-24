/* Spec bot (docs/postflop_spec.md §11, §12): the decision trace. One record per action; every step writes its own part (step0 .. step7) while it
   computes, and nothing is changed afterwards. At the end of the hand the record gets result and check (the review log of §11), and the
   last few hands are kept in the browser (docs/bot_rebuild_plan.md §8.3). The explanation text is made from these records only (explain.js).
   Works in the browser (window.SpecTrace) and in node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecTrace = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1;
  // the parts a finished decision must have (§12's table); a decision handed to the old bot has only step0 and other
  const REQUIRED = ['step0', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'other'];
  function create(info) {
    return { v: VERSION, hand: info.hand, seat: info.seat, pos: info.pos, name: info.name, hole: info.hole.slice(), board: info.board.slice(), street: info.street,
      actionNo: info.actionNo, step0: null, step1: null, step2: null, step3: null, step4: null, step5: null, step6: null, step7: null,
      other: { equityMode: null, ms: 0, fallback: null, note: [] }, decision: null };
  }
  function missing(tr) {   // the required parts that are still empty (a legacy decision needs only step0, other and decision)
    if (tr.other && tr.other.fallback) return ['step0', 'other', 'decision'].filter(k => !tr[k]);
    return REQUIRED.concat(['decision']).filter(k => !tr[k]);
  }
  /* the hand's records: SpecTrace.Hand keeps them, then saves the last keep hands under storeKey (localStorage; ignored where there is none) */
  class Hand {
    constructor(id) { this.id = id; this.records = []; this.t = Date.now(); }
    add(tr) { this.records.push(tr); return tr; }
    finish(result) {   // result: {board, shown: {seat: [a, b]}, actions: [{seat, street, act, to}]} from the game
      for (const tr of this.records) {
        tr.result = { board: result.board.slice(), oppActions: result.actions.filter(a => a.seat !== tr.seat && (a.street > tr.street || (a.street === tr.street && a.n > tr.actionNo))), shown: result.shown };
        tr.check = tr.check || null;   // filled by the estimate / outcome comparison once the ranges are kept (stage 2+)
      }
    }
  }
  function save(storage, key, hand, keep) {
    if (!storage) return false;
    try {
      const raw = storage.getItem(key); const all = raw ? JSON.parse(raw) : [];
      all.push({ id: hand.id, t: hand.t, records: hand.records });
      while (all.length > keep) all.shift();
      for (;;) {   // too big for the browser's quota: drop the oldest until it fits
        try { storage.setItem(key, JSON.stringify(all)); return true; }
        catch (e) { if (all.length <= 1) return false; all.shift(); }
      }
    } catch (e) { return false; }
  }
  function load(storage, key) {
    if (!storage) return [];
    try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  return { VERSION, REQUIRED, create, missing, Hand, save, load };
});
