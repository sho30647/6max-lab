/* Spec bot (docs/postflop_spec.md): the entry point. index.html calls
     SpecBot.attach(game)            once: the game's state and helpers (the bot reads the game only through this object)
     SpecBot.newHand()               at the start of every hand
     SpecBot.onAction(seat, info)    after every action of every player (preflop: the chart spot it was taken in; postflop: Step1 narrows the ranges)
     SpecBot.decide(seat)            for a postflop decision of a player with ver === 'spec'; returns {act, to} like the old bot
     SpecBot.endHand()               after the settlement (result and check of the review log; the traces are saved)
   The decision itself is in strategy.js (Step2-Step7); the pots phase 1 leaves out go to the old bot (v13), and so does a decision that throws.
   Works in the browser (window.SpecBot) and in node (require). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const R = n => node ? require('./' + n + '.js') : root[{ params: 'SpecParams', trace: 'SpecTrace', equity: 'SpecEquity', preflop: 'SpecPreflop', ranges: 'SpecRanges', cards: 'SpecCards', strategy: 'SpecStrategy', explain: 'SpecExplain' }[n]];
  const api = factory(R('params'), R('trace'), R('equity'), R('preflop'), R('ranges'), R('cards'), R('strategy'), R('explain'));
  if (node) module.exports = api; else root.SpecBot = api;
})(typeof self !== 'undefined' ? self : this, function (P, T, E, PF, RG, C, ST, EX) {
  'use strict';
  let G = null;                 // the game (attach)
  let hand = null, handNo = 0, actions = [], nAct = 0;
  let preActs = {};             // seat -> [{spot, act}]: the chart spots of its preflop actions
  let views = new Map();        // params -> {ranges: HandRanges, updates: [...]}: the hand's ranges, one set per parameter set in play
  let lastDecision = {};        // seat -> nAct at its last decision (the trace's Step1 lists the updates since then)
  const counts = { decisions: 0, legacy: {} };   // how often a decision went to the old bot, by reason (§2 Step0: the pots outside phase 1 are counted)
  let equityMode = null;        // 'exact' | 'split3' | 'split2', decided once per session (docs/decisions.md)
  // the bot's own dice for its samples: the game's Math.random stream (the cards, the other bots' dice) stays as it would be without the bot
  let rs = 0x2545F491;
  const rng = () => { rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  function attach(game) { G = game; }
  function paramsOf(p) { return p.specParams || P.DEFAULTS; }
  const isSpec = p => p && p.ver === 'spec';

  function newHand() { rs = 0x2545F491 ^ (handNo * 0x9E3779B1); handNo++; hand = new T.Hand(Date.now() + '-' + handNo); actions = []; nAct = 0; preActs = {}; views = new Map(); lastDecision = {}; }

  /* the preflop line: who opened, who 3-bet / 4-bet, the limpers, and the callers who make a 3-bet pot leave phase 1
     (coldCallers: a call of the open by a player other than the 3-bettor-to-be (in a 3-bet pot: a squeeze), or a call of a 3-bet or more by a player who had not raised) */
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
  function potTypeOf(r) { return r <= 1 ? 'LIMP' : r === 2 ? 'SRP' : r === 3 ? '3BP' : '4BP'; }
  /* why a pot goes to the old bot (phase 1 leaves these out, §2), or null */
  function legacyReason(potType, line) {
    if (potType === 'LIMP' || line.limpers.length) return 'legacy:limp';   // a limped pot, or a raised pot a limper called
    if (potType !== 'SRP' && line.coldCallers.length) return 'legacy:cold3';
    return null;
  }
  function inScope() {   // a spec bot is in the hand, and the pot is one phase 1 plays
    const S = G.S;
    if (!S.players.some(p => isSpec(p) && !p.folded)) return false;
    return !legacyReason(potTypeOf(S.pfRaises), preflopLine());
  }

  /* the flop's equity mode, decided once from a timed sample of the work (docs/decisions.md) */
  function pickMode(board, only, prm) {
    if (equityMode) return equityMode;
    const d = prm.design.equity;
    new E.StreetTable(board, only, 1, rng);             // a first run warms the code up (its time would count the compiler)
    const t0 = now(), t = new E.StreetTable(board, only, 1, rng);   // about 1 river per turn card: ~47 of the 1,081 runouts
    // x1.6: from the timed sample's ranking to the whole flop's work (the street's set-up and the decision's sweeps): the largest exact flop decision
    // was 1.6x this estimate on a desktop CPU and about 3x on a CPU slowed 4x (tests/spec-decisions.mjs, docs/decisions.md); 1.6 keeps a desktop on the exact mode
    const ms = Math.max(0.01, now() - t0), full = ms * (1081 / Math.max(1, t.runouts.length)) * 1.6;
    equityMode = full <= d.exactMaxMs ? 'exact' : full * 0.31 <= d.splitMaxMs ? 'split3' : 'split2';   // the split work is ~31% of the exact (measured)
    counts.modeProbe = { ms: Math.round(ms * 10) / 10, fullEst: Math.round(full), mode: equityMode };
    return equityMode;
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /* the ranges of the current street, set up at the street's first event */
  function view(prm) {
    let v = views.get(prm);
    if (!v) { v = { ranges: new RG.HandRanges(prm), updates: [] }; views.set(prm, v); }
    return v;
  }
  function ensureStreet() {
    const S = G.S;
    if (S.street < 1 || !inScope()) return null;
    const prmSet = new Set(S.players.filter(p => isSpec(p) && !p.folded).map(paramsOf));
    for (const prm of prmSet) {
      const v = view(prm), H = v.ranges;
      if (H.street === S.street) continue;
      if (H.street < 1) S.players.forEach((q, i) => { if (!q.folded) H.setPre(i, PF.rangeOf(preActs[i] || [])); });
      let opts = { extra: S.players.filter(q => isSpec(q) && !q.folded).map(q => C.comboOf(q.hole[0], q.hole[1])) };
      if (S.street === 1) {
        const only = new Uint8Array(1326); for (const s of H.seats()) { const W = H.W[s]; for (let i = 0; i < 1326; i++) if (W[i] > 0) only[i] = 1; }
        const mode = pickMode(S.board, only, prm);
        if (mode !== 'exact') Object.assign(opts, { perCard: mode === 'split3' ? prm.design.equity.splitPerCard : prm.design.equity.splitPerCardMin, rng });
      }
      H.startStreet(S.street, S.board, opts);
      H.mode = S.street === 1 ? equityMode : 'exact';
    }
    return true;
  }

  /* §3: the row of the update table for an action */
  function updateKind(seat, info) {
    const S = G.S;
    if (info.act === 'call') return 'callBet';
    if (info.act === 'raise') return 'raiseBet';
    if (info.act === 'bet') return null;   // by size, below
    if (info.act === 'check') {
      const agg = S.street === 1 ? S.pfAggr : S.prevStreetAggr;
      if (agg === seat) return 'checkAggr';
      return G.isIP(seat) ? 'checkBackIP' : 'checkOOPCaller';
    }
    return null;
  }

  function onAction(seat, info) {   // info: {street, act: 'fold'|'check'|'call'|'bet'|'raise', to, potBefore, toCall, allIn, pre: {spot, kind} (preflop)}
    nAct++;
    const a = Object.assign({ seat, n: nAct }, info); delete a.pre; actions.push(a);
    if (info.street === 0) { if (info.pre && info.act !== 'fold') (preActs[seat] = preActs[seat] || []).push({ spot: info.pre.spot, act: info.act }); return; }
    if (!ensureStreet()) return;
    for (const [prm, v] of views) {
      const H = v.ranges;
      if (info.act === 'fold') { H.drop(seat); v.updates.push({ n: nAct, seat, act: 'fold' }); continue; }
      const eq = prm.equilibrium;
      let kind = updateKind(seat, info), size = null;
      // a bet: the row by its size, on a line between the sizes of the table (§3, docs/decisions.md 2026-10-27); an older params set: betSmall / betBig
      if (info.act === 'bet') { size = info.potBefore > 0 ? info.to / info.potBefore : 1; kind = eq.updateMult.betSize ? 'bet' : size >= eq.updateMult.bigBet ? 'betBig' : 'betSmall'; }
      const mult = prm.hooks.updateMult({ seat, kind, street: info.street, size }, info.act === 'bet' ? RG.betMult(eq.updateMult, size) : eq.updateMult[kind]);
      const r = H.apply(seat, mult);
      if (r) v.updates.push(Object.assign({ n: nAct, seat, act: info.act, kind, size }, r));
    }
  }

  /* Step0 (§2): the state of this decision */
  function step0(seat) {
    const S = G.S, p = S.players[seat], prm = paramsOf(p).equilibrium;
    const live = S.players.map((q, i) => i).filter(i => !S.players[i].folded);
    const opps = live.filter(i => i !== seat);
    const pot = G.potTotal(), toCall = S.currentBet - p.bet;
    const effStack = Math.min(p.stack, Math.max(0, ...opps.map(i => S.players[i].stack + S.players[i].bet - p.bet)));
    const line = preflopLine();
    const potType = potTypeOf(S.pfRaises);
    const spr = pot > 0 ? effStack / pot : Infinity;
    const ip = G.isIP(seat);
    // initiative: the player who bet or raised last on the previous street (none if it went check-check); on the flop, the preflop aggressor
    const agg = S.street === 1 ? S.pfAggr : S.prevStreetAggr;
    const initiative = agg === seat ? 'me' : agg >= 0 && !S.players[agg].folded ? 'opp' : 'none';
    let nodeKind;
    if (toCall > 0) nodeKind = S.raiseCount >= 2 ? 'facingRaise' : 'facingBet';
    else if (initiative === 'me') nodeKind = 'cbet';                 // c-bet / barrel
    else if (initiative === 'opp') nodeKind = ip ? 'stab' : 'donk';   // in position: the aggressor checked to it this street
    else nodeKind = ip ? 'delayed' : 'probe';                        // the last street went check-check
    return { street: S.street, potType, spr: Math.round(spr * 100) / 100, sprClass: spr < prm.sprLow ? 'low' : spr <= prm.sprHigh ? 'mid' : 'high',
      ip, initiative, nodeKind, nPlayers: live.length, pot, toCall, effStack, bb: G.BB(), line };
  }

  /* Step1 for the trace: the bucket shares of this player and of the others now, and the updates since its last decision */
  function step1(seat, prm) {
    const v = views.get(prm); if (!v) return null;
    const H = v.ranges, since = lastDecision[seat] || 0;
    const opp = H.seats().filter(s => s !== seat);
    return { me: { now: H.bucketShares(seat) }, opp: opp.map(s => ({ seat: s, now: H.bucketShares(s) })),
      applied: v.updates.filter(u => u.n > since).map(u => ({ seat: u.seat, pos: G.posOf(u.seat), act: u.act, kind: u.kind || null, size: u.size == null ? null : Math.round(u.size * 100) / 100, mult: u.mult || null, before: u.before || null, after: u.after || null })),
      equityMode: H.mode, ms: H.ms };
  }

  /* the decision context for strategy.js */
  function context(seat, prm, s0, tr) {
    const S = G.S, p = S.players[seat], v = views.get(prm), H = v.ranges;
    const live = H.seats(), opps = live.filter(x => x !== seat);
    const Wop = H.others(seat), Wme = H.W[seat];
    let preOpp = null, preMe = null;
    if (opps.length === 1) { preOpp = PF.rangeOf(preActs[opps[0]] || []); preMe = PF.rangeOf(preActs[seat] || []); }
    return { prm, seat, street: S.street, board: S.board.slice(), hole: p.hole.slice(), own: C.comboOf(p.hole[0], p.hole[1]), P: s0.pot, toCall: s0.toCall,
      stack: p.stack, myBet: p.bet, currentBet: S.currentBet, effStack: s0.effStack, ip: s0.ip, nodeKind: s0.nodeKind, initiative: s0.initiative, sprClass: s0.sprClass,
      nOpp: opps.length, H, Wme, Wop, WopRaw: opps.length === 1 ? H.W[opps[0]] : null, rng, tr, diag: !!api.diag, bb: G.BB(), isPfAggr: S.pfAggr === seat, preOpp, preMe };
  }
  /* the chips of a bet of B for the game: at least a big blind; all-in when what would be left is less than the pot after the bet (§9, docs/decisions.md) */
  function betTo(p, B, P) {
    const bb = G.BB(); let amt = Math.max(bb, Math.round(B));
    if (amt >= p.stack || p.stack - amt < P + 2 * amt) amt = p.stack;
    return amt + p.bet;
  }

  function decide(seat) {
    const S = G.S, p = S.players[seat], t0 = now(), prm = paramsOf(p);
    if (!hand) newHand();
    const tr = hand.add(T.create({ hand: hand.id, seat, pos: G.posOf(seat), name: p.name, hole: p.hole, board: S.board, street: S.street, actionNo: nAct }));
    counts.decisions++;
    tr.step0 = step0(seat);
    const oppSeats = S.players.map((q, i) => i).filter(i => i !== seat && !S.players[i].folded);
    tr.oppPos = oppSeats.length === 1 ? G.posOf(oppSeats[0]) : null;
    const why = api.passThrough ? 'passThrough' : legacyReason(tr.step0.potType, tr.step0.line);   // passThrough: every decision to the old bot (tests/spec-stage0.mjs)
    let dec = null;
    if (!why) {
      try {
        ensureStreet();
        tr.step1 = step1(seat, prm); tr.other.equityMode = tr.step1 && tr.step1.equityMode;
        // measurement only (tests/spec-theory.mjs): the bucket of the player's own hand in the street's table, against what its range says (§3's read)
        if (api.diag) { const c = views.get(prm).ranges.cache[seat]; tr.other.ownBucket = c ? c.bucket[C.comboOf(p.hole[0], p.hole[1])] : null; }
        const ctx = context(seat, prm, tr.step0, tr);
        if (!(ctx.Wme && ctx.Wop.some(w => w > 0))) throw new Error('empty range');
        ST.prepare(ctx);
        const s2 = ST.step2(ctx), s3 = ST.step3(ctx);
        if (tr.step0.toCall > 0) {
          tr.step4 = { facing: true };
          const r = ST.facing(ctx);
          dec = r.act === 'raise' ? { act: 'raise', to: r.to } : { act: r.act };
        } else {
          const s4 = ST.step4(ctx, s3, s2);
          const r = ST.betNode(ctx, s4);
          dec = r.act === 'bet' ? { act: 'raise', to: betTo(p, r.B, ctx.P) } : { act: 'check' };
        }
        counts.spec = (counts.spec || 0) + 1;
      } catch (e) {
        tr.other.fallback = 'error'; tr.other.note.push(String(e && e.stack || e).slice(0, 400)); counts.legacy.error = (counts.legacy.error || 0) + 1;
        if (typeof console !== 'undefined') console.warn('SpecBot decide', e);
        dec = null;
      }
    } else { tr.other.fallback = why; counts.legacy[why] = (counts.legacy[why] || 0) + 1; }
    if (!dec) dec = G.legacy(seat);
    tr.decision = { act: dec.act, to: dec.to || 0, bet: dec.act === 'raise' && tr.step0.toCall === 0 };
    lastDecision[seat] = nAct;
    tr.other.ms = Math.round(now() - t0);
    return dec;
  }

  function endHand() {
    if (!hand) return null;
    const S = G.S, shown = {};
    if (S.showdown) S.players.forEach((q, i) => { if (!q.folded) shown[i] = q.hole.slice(); });
    // the action the game applied for each decision (after its rounding: minimum raise, all-in), for the explanation's conclusion
    for (const tr of hand.records) { const a = actions.find(x => x.seat === tr.seat && x.n > tr.actionNo && x.street === tr.street); if (a) tr.applied = { act: a.act, to: a.to, allIn: !!a.allIn }; }
    hand.finish({ board: S.board, shown, actions });
    if (hand.records.length && G.storage) T.save(G.storage(), G.traceKey ? G.traceKey() : 'spec_traces', hand, P.DEFAULTS.design.traceKeepHands);
    const h = hand; hand = null; api.lastHand = h; return h;
  }

  /* §12: the explanation of a decision (trace) or of every decision of a hand ({records}) */
  function explain(tr, prm) { return EX.explain(tr, prm || P.DEFAULTS); }
  function explainHand(h, prm) { return (h || {}).records ? h.records.map(tr => explain(tr, prm)) : []; }
  /* the explanations of the saved hands as plain text (the last n hands; the browser keeps 50): until the review screen exists, this is how to read them,
     e.g. in the browser console: copy(SpecBot.explainSaved(1)) */
  /* a saved hand by its id (the hand record of the game keeps it as rec.sh), or null */
  function savedHand(id) {
    const all = G && G.storage ? T.load(G.storage(), G.traceKey ? G.traceKey() : 'spec_traces') : [];
    return all.find(h => h.id === id) || (api.lastHand && api.lastHand.id === id ? api.lastHand : null);
  }
  function explainSaved(n) {
    const all = G && G.storage ? T.load(G.storage(), G.traceKey ? G.traceKey() : 'spec_traces') : [];
    return all.slice(-(n || 1)).map(h => h.records.map(tr => explain(tr).text).join('\n\n')).join('\n\n' + '='.repeat(40) + '\n\n');
  }

  const api = { diag: false, attach, explain, explainHand, explainSaved, savedHand, lastHand: null, passThrough: false, newHand, onAction, decide, endHand, counts, preflopLine, step0, get hand() { return hand; }, get views() { return views; }, get preActs() { return preActs; },
    setEquityMode(m) { equityMode = m; } };
  return api;
});
