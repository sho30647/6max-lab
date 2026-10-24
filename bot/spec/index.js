/* Spec bot (docs/postflop_spec.md): the entry point. index.html calls
     SpecBot.attach(game)            once: the game's state and helpers (the bot reads the game only through this object)
     SpecBot.newHand()               at the start of every hand
     SpecBot.onAction(seat, info)    after every action of every player (Step1 narrows the ranges from these)
     SpecBot.decide(seat)            for a postflop decision of a player with ver === 'spec'; returns {act, to} like the old bot
     SpecBot.endHand()               after the settlement (result and check of the review log; the traces are saved)
   Stage 0 (docs/bot_rebuild_plan.md §6): every decision is still the old bot's (v13); the trace records the state (Step0) and the hand-over.
   Works in the browser (window.SpecBot) and in node (require). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./params.js') : root.SpecParams, node ? require('./trace.js') : root.SpecTrace);
  if (node) module.exports = api; else root.SpecBot = api;
})(typeof self !== 'undefined' ? self : this, function (P, T) {
  'use strict';
  let G = null;                 // the game (attach)
  let hand = null, handNo = 0, actions = [], nAct = 0;
  const counts = { decisions: 0, legacy: {} };   // how often a decision went to the old bot, by reason (§2 Step0: the pots outside phase 1 are counted)

  function attach(game) { G = game; }
  function paramsOf(p) { return p.specParams || P.DEFAULTS; }

  function newHand() { handNo++; hand = new T.Hand(Date.now() + '-' + handNo); actions = []; nAct = 0; }

  function onAction(seat, info) {   // info: {street, act: 'fold'|'check'|'call'|'bet'|'raise', to, potBefore, toCall, allIn}
    nAct++; actions.push(Object.assign({ seat, n: nAct }, info));
  }

  /* the preflop line from the game's log: who opened, who 3-bet / 4-bet, and who called cold (a call of a raise by a player who had not raised) */
  function preflopLine() {
    const S = G.S, line = { opener: -1, threeBettor: -1, fourBettor: -1, coldCallers: [], limpers: [] };
    let raises = 1;   // the big blind counts as the first "raise" (S.raiseCount starts at 1)
    for (const a of actions) {
      if (a.street !== 0) continue;
      if (a.act === 'raise' || a.act === 'bet') {
        raises++;
        if (raises === 2) line.opener = a.seat; else if (raises === 3) line.threeBettor = a.seat; else if (raises === 4) line.fourBettor = a.seat;
      } else if (a.act === 'call') {
        if (raises === 1) line.limpers.push(a.seat);
        else if (!(raises === 3 && a.seat === line.opener) && !(raises === 4 && a.seat === line.threeBettor) && !(raises >= 5)) line.coldCallers.push(a.seat);
      }
    }
    line.raises = raises; line.pfRaises = S.pfRaises;
    return line;
  }

  /* Step0 (§2): the state of this decision */
  function step0(seat) {
    const S = G.S, p = S.players[seat], prm = paramsOf(p).equilibrium;
    const live = S.players.map((q, i) => i).filter(i => !S.players[i].folded);
    const opps = live.filter(i => i !== seat);
    const pot = G.potTotal(), toCall = S.currentBet - p.bet;
    const effStack = Math.min(p.stack, Math.max(0, ...opps.map(i => S.players[i].stack + S.players[i].bet - p.bet)));
    const line = preflopLine();
    const r = S.pfRaises;
    const potType = r <= 1 ? 'LIMP' : r === 2 ? 'SRP' : r === 3 ? '3BP' : '4BP';
    const spr = pot > 0 ? effStack / pot : Infinity;
    const ip = G.isIP(seat);
    // initiative: the player who bet or raised last on the previous street (none if it went check-check); on the flop, the preflop aggressor
    const agg = S.street === 1 ? S.pfAggr : S.prevStreetAggr;
    const initiative = agg === seat ? 'me' : agg >= 0 && !S.players[agg].folded ? 'opp' : 'none';
    let nodeKind;
    if (toCall > 0) nodeKind = S.raiseCount >= 2 ? 'facingRaise' : 'facingBet';
    else if (initiative === 'me') nodeKind = 'cbet';              // c-bet / barrel
    else if (initiative === 'opp') nodeKind = ip ? 'stab' : 'donk';   // in position: the aggressor checked to it this street
    else nodeKind = ip ? 'delayed' : 'probe';                     // the last street went check-check
    return { street: S.street, potType, spr: Math.round(spr * 100) / 100, sprClass: spr < prm.sprLow ? 'low' : spr <= prm.sprHigh ? 'mid' : 'high',
      ip, initiative, nodeKind, nPlayers: live.length, pot, toCall, effStack, bb: G.BB(), line };
  }

  /* why this decision goes to the old bot (phase 1 leaves these pots out, §2), or null */
  function legacyReason(s0) {
    if (s0.potType === 'LIMP' || s0.line.limpers.length) return 'legacy:limp';   // a limped pot, or a raised pot a limper called
    if (s0.potType !== 'SRP' && s0.line.coldCallers.length) return 'legacy:cold3';
    return null;
  }

  function decide(seat) {
    const S = G.S, p = S.players[seat], t0 = Date.now();
    if (!hand) newHand();
    const tr = hand.add(T.create({ hand: hand.id, seat, pos: G.posOf(seat), name: p.name, hole: p.hole, board: S.board, street: S.street, actionNo: nAct }));
    counts.decisions++;
    tr.step0 = step0(seat);
    // stage 0: the new logic is not there yet, every decision is the old bot's
    const why = legacyReason(tr.step0) || 'stage0';
    tr.other.fallback = why; counts.legacy[why] = (counts.legacy[why] || 0) + 1;
    const dec = G.legacy(seat);
    tr.decision = { act: dec.act, to: dec.to || 0 };
    tr.other.ms = Date.now() - t0;
    return dec;
  }

  function endHand() {
    if (!hand) return null;
    const S = G.S, shown = {};
    if (S.showdown) S.players.forEach((q, i) => { if (!q.folded) shown[i] = q.hole.slice(); });
    hand.finish({ board: S.board, shown, actions });
    if (hand.records.length && G.storage) T.save(G.storage(), G.traceKey ? G.traceKey() : 'spec_traces', hand, P.DEFAULTS.design.traceKeepHands);
    const h = hand; hand = null; return h;
  }

  return { attach, newHand, onAction, decide, endHand, counts, preflopLine, step0, get hand() { return hand; } };
});
