/* Spec bot (docs/postflop_spec.md §5-§10): the decision, Step3 to Step7, on the ranges kept by ranges.js.
   Every step writes what it computed into the decision trace (tr.step3 .. tr.step7, §12) and nothing else; explain.js makes the text from it.
   ctx (index.js builds it): prm, seat, street, board, hole, own (the bot's combo), P (pot), toCall, stack, effStack, ip, nodeKind, initiative,
     nOpp, sprClass, H (HandRanges), Wme (the bot's range as the others see it), Wop (the others' ranges, summed), rng (the bot's dice), tr.
   Works in the browser (window.SpecStrategy) and in node (require). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const R = n => node ? require('./' + n + '.js') : root[{ cards: 'SpecCards', equity: 'SpecEquity', ranges: 'SpecRanges', texture: 'SpecTexture', preflop: 'SpecPreflop' }[n]];
  const api = factory(R('cards'), R('equity'), R('ranges'), R('texture'), R('preflop'));
  if (node) module.exports = api; else root.SpecStrategy = api;
})(typeof self !== 'undefined' ? self : this, function (C, E, RG, TX, PF) {
  'use strict';
  const { NC, CA, CB, CLASS } = C;
  const r3 = x => x == null || isNaN(x) ? null : Math.round(x * 1000) / 1000;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* the equities this decision needs, against the ranges as they are now (the street's table is re-used: no new hand evaluation) */
  function prepare(ctx) {
    const T = ctx.H.table, river = ctx.street === 3;
    ctx.swMe = T.sweep(ctx.Wop, !river);          // every combo of the bot's range against the others now: E, and D / V before the river
    ctx.swOp = T.sweep(ctx.Wme, false);           // the others' combos against the bot's range (their reactions, the nut advantage)
    // the bot's own hand: exact (when the flop's table is a sample, docs/decisions.md)
    if (!T.exact) { const h = E.handExact(ctx.hole, ctx.board, ctx.Wop); ctx.ownExact = h; }
  }
  /* E, D, V and the nuttiness of combo i (the bot's own hand from the exact count when there is one) */
  function attrs(ctx, i) {
    const eq = ctx.prm.equilibrium, river = ctx.street === 3;
    if (i === ctx.own && ctx.ownExact) {
      const dv = river ? { D: 0, V: 0 } : E.devVulOf(ctx.ownExact.nextEq, eq.devHi, eq.vulLo);
      let up = 0, nut = 0; if (!river) for (let c = 0; c < 52; c++) { const e = ctx.ownExact.nextEq[c]; if (e >= eq.devHi) { up++; if (e >= 0.95) nut++; } }
      return { E: ctx.ownExact.eq, D: dv.D, V: dv.V, nutty: up ? nut / up : null };
    }
    const e = ctx.swMe.eq[i];
    if (river) return { E: e, D: 0, V: 0, nutty: null };
    const sw = ctx.swMe; let n = 0, d = 0, v = 0, nut = 0;
    for (let c = 0; c < 52; c++) { const t = sw.nextTot[i * 52 + c]; if (!(t > 0)) continue; const x = sw.nextWin[i * 52 + c] / t; n++; if (x >= eq.devHi) { d++; if (x >= 0.95) nut++; } if (x < eq.vulLo) v++; }
    return { E: e, D: n ? d / n : 0, V: n ? v / n : 0, nutty: d ? nut / d : null };
  }
  function bucketOf(ctx, a) {
    const eq = ctx.prm.equilibrium;
    // §7: a draw whose completions are not the nuts counts less (D x (0.5 + 0.5 x nuttiness)), docs/decisions.md
    const D = a.nutty == null ? a.D : a.D * (0.5 + 0.5 * a.nutty);
    return RG.bucketOf(a.E, D, ctx.street === 3, { b1: eq.bucket.b1, b2: eq.bucket.b2, b3: eq.bucket.b3, drawMaxE: eq.bucket.drawMaxE, devD: eq.devD });
  }

  /* Step2 (§4): the texture, with the static / dynamic axis from the bot's range */
  function step2(ctx) {
    const eq = ctx.prm.equilibrium, W = ctx.Wme, sw = ctx.swMe;
    let dynScore = null;
    if (ctx.street < 3) {
      let a = 0, t = 0; for (let i = 0; i < NC; i++) if (W[i] > 0 && sw.eq[i] >= 0) { a += W[i] * sw.eq[i]; t += W[i]; }
      const now = t ? a / t : 0.5; let moved = 0, n = 0;
      for (let c = 0; c < 52; c++) {
        let ac = 0, tc = 0;
        for (let i = 0; i < NC; i++) { if (!(W[i] > 0)) continue; const tt = sw.nextTot[i * 52 + c]; if (!(tt > 0)) continue; ac += W[i] * sw.nextWin[i * 52 + c] / tt; tc += W[i]; }
        if (tc > 0) { n++; if (Math.abs(ac / tc - now) >= eq.dynMove) moved++; }
      }
      dynScore = n ? moved / n : 0;
    }
    const ax = TX.axes(ctx.board, dynScore, eq.staticDynamic);
    const s2 = Object.assign({}, ax, { newCard: ctx.street > 1 ? TX.newCardClass(ctx.board) : null });
    ctx.tr.step2 = s2; return s2;
  }

  /* Step3 (§5): range advantage RA, nut advantage NA, the middle layer, and what the nuts are made of (docs/bot_rebuild_plan.md §8.3) */
  function step3(ctx) {
    const eq = ctx.prm.equilibrium, Wm = ctx.Wme, Wo = ctx.Wop, em = ctx.swMe.eq, eo = ctx.swOp.eq;
    let am = 0, tm = 0, nm = 0, mid = 0, ao = 0, to = 0, no = 0;
    for (let i = 0; i < NC; i++) {
      if (Wm[i] > 0 && em[i] >= 0) { am += Wm[i] * em[i]; tm += Wm[i]; if (em[i] >= eq.nutEq) nm += Wm[i]; if (em[i] >= eq.midBand[0] && em[i] < eq.midBand[1]) mid += Wm[i]; }
      if (Wo[i] > 0 && eo[i] >= 0) { ao += Wo[i] * eo[i]; to += Wo[i]; if (eo[i] >= eq.nutEq) no += Wo[i]; }
    }
    const raMine = tm ? am / tm - 0.5 : 0, raOpp = to ? ao / to - 0.5 : 0;
    const ra = raMine, raEff = ra - (ctx.ip ? 0 : eq.oopRaAdj);
    const na = (tm ? nm / tm : 0) - (to ? no / to : 0);
    // the nuts' make-up: the classes with the most weight among the combos that beat the other range 80%+, and how much of each the other side keeps
    const top = (W, e, Wother, preOther) => {
      const m = new Map(); let t = 0;
      for (let i = 0; i < NC; i++) if (W[i] > 0 && e[i] >= eq.nutEq) { m.set(CLASS[i], (m.get(CLASS[i]) || 0) + W[i]); t += W[i]; }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cls, w]) => ({ cls, share: r3(w / t), oppPre: preOther ? r3(PF.classShare(preOther, cls)) : null, oppNow: Wother ? r3(PF.classShare(Wother, cls)) : null }));
    };
    const nutsTop = { mine: top(Wm, em, ctx.WopRaw, ctx.preOpp), opp: top(Wo, eo, ctx.nOpp === 1 ? Wm : null, ctx.preMe) };   // the shares are of the other side's own weights (not the summed, scaled range)
    // §5's check: on an A / K high flop the preflop raiser should not be behind; flag it if it is (the ranges may be read wrong)
    let checkFlag = null;
    if (ctx.street === 1 && ctx.isPfAggr && ctx.tr.step2 && (ctx.tr.step2.high === 'A' || ctx.tr.step2.high === 'KQ') && ra < -0.05) checkFlag = 'raiser behind on a high flop';
    const s3 = { raMine: r3(raMine), raOpp: r3(raOpp), ra: r3(ra), raEff: r3(raEff), na: r3(na), mid: r3(tm ? mid / tm : 0), nutsMine: r3(tm ? nm / tm : 0), nutsOpp: r3(to ? no / to : 0), checkFlag, nutsTop };
    ctx.tr.step3 = s3; return s3;
  }

  /* Step4 (§6): the target bet frequency and the sizes, by bilinear interpolation on the 9 points, then the corrections */
  function step4(ctx, s3, s2) {
    const eq = ctx.prm.equilibrium, g = eq.nodeGrid, th = eq.raNaThresh;
    const x = clamp(s3.raEff / th, -1, 1), y = clamp(s3.na / th, -1, 1);   // -1 .. +1 = -5pt .. +5pt
    // the RA+/NA+ point's size: static 29% .. dynamic 63% along the dynamic score (docs/decisions.md)
    const ds = s2.dynScore == null ? 0 : s2.dynScore, lo = eq.staticDynamic[0], hi = eq.staticDynamic[1];
    const topSize = g.sizeTopStatic + (g.sizeTopDynamic - g.sizeTopStatic) * clamp((ds - lo) / (hi - lo), 0, 1);
    const val = (grid, i, j) => grid[i][j] == null ? topSize : grid[i][j];
    const interp = grid => {
      const fi = x + 1, fj = y + 1, i0 = Math.min(1, Math.floor(fi)), j0 = Math.min(1, Math.floor(fj)), u = fi - i0, v = fj - j0;
      return (1 - u) * (1 - v) * val(grid, i0, j0) + u * (1 - v) * val(grid, i0 + 1, j0) + (1 - u) * v * val(grid, i0, j0 + 1) + u * v * val(grid, i0 + 1, j0 + 1);
    };
    let freq = interp(g.freq); const sizeRaw = interp(g.size);
    const L = eq.sizeLadder;
    // the nearest ladder size, and the nearest on the other side of the computed size (docs/decisions.md)
    let k1 = 0; for (let k = 1; k < L.length; k++) if (Math.abs(L[k] - sizeRaw) < Math.abs(L[k1] - sizeRaw)) k1 = k;
    let k2 = L[k1] >= sizeRaw ? k1 - 1 : k1 + 1; if (k2 < 0 || k2 >= L.length) k2 = null;
    const adjust = [];
    let shift = 0;
    if (!ctx.ip) { freq -= eq.stepFreq; adjust.push('oop'); }
    if (s2.dyn === 'static') { shift -= 1; adjust.push('static'); }
    if (s2.dyn === 'dynamic') { shift += 1; freq -= eq.stepFreq; adjust.push('dynamic'); }
    if (ctx.street === 2) { shift += 1; adjust.push('turn'); } else if (ctx.street === 3) { shift += 2; adjust.push('river'); }
    const at = k => k == null ? null : L[clamp(k + shift, 0, L.length - 1)];
    let sizes = [at(k1)]; const s2b = at(k2); if (s2b != null && s2b !== sizes[0]) sizes.push(s2b);
    // a low SPR: the size that gets the stacks in is a candidate (it replaces the bigger one)
    const jamSize = ctx.effStack / ctx.P;
    if (ctx.sprClass === 'low') { adjust.push('lowSpr'); sizes = sizes.length > 1 ? [Math.min(...sizes), jamSize] : [jamSize]; }
    sizes = sizes.map(s => Math.min(s, jamSize)).filter((s, i, a) => a.indexOf(s) === i);
    // a donk bet (§2): check, unless the turn / river card turned the advantage to the bot (RA or NA over the threshold)
    let donkOpen = null;
    if (ctx.nodeKind === 'donk') { donkOpen = ctx.street > 1 && (s3.raEff >= th || s3.na >= th); if (!donkOpen) { freq = 0; adjust.push('donkCheck'); } else adjust.push('donkOpen'); }
    freq = clamp(freq, 0, 0.95);
    const s4 = { x: r3(x), y: r3(y), freq: r3(freq), sizeRaw: r3(sizeRaw), topSize: r3(topSize), sizes: sizes.map(r3), slowB1: ctx.ip ? 0 : eq.oopSlowB1, adjust, donkOpen };
    ctx.tr.step4 = s4; return s4;
  }

  /* Step6 (§8): the opponents' reaction to a bet of size s (share of the pot): fold / call / raise, by their equity against the bot's range */
  function reaction(ctx, s) {
    const eq = ctx.prm.equilibrium, P = ctx.P, B = s * P, Wo = ctx.Wop, eo = ctx.swOp.eq;
    const need = B / (P + 2 * B) + eq.marginReact;
    const rate = ctx.street === 1 ? eq.raiseRate.flop : ctx.street === 2 ? eq.raiseRate.turn : eq.raiseRate.river;
    const callers = [];
    let tot = 0, wc = 0;
    for (let i = 0; i < NC; i++) { const w = Wo[i]; if (!(w > 0) || !(eo[i] >= 0)) continue; tot += w; if (eo[i] > need) { callers.push(i); wc += w; } }
    callers.sort((a, b) => eo[b] - eo[a]);
    const Wcall = new Float32Array(NC), Wraise = new Float32Array(NC), Wfold = new Float32Array(NC);
    let acc = 0;
    for (const i of callers) { if (acc < rate * wc && ctx.stack > B) { Wraise[i] = Wo[i]; acc += Wo[i]; } else Wcall[i] = Wo[i]; }
    let wf = 0; for (let i = 0; i < NC; i++) if (Wo[i] > 0 && eo[i] >= 0 && !(eo[i] > need)) { Wfold[i] = Wo[i]; wf += Wo[i]; }
    let fe = tot ? wf / tot : 0, rho = tot ? acc / tot : 0;
    // several opponents: the bet takes the pot only if every one folds (§10): FE = (fold share) ^ opponents, the raise chance 1 - (1 - raise share) ^ opponents
    if (ctx.nOpp > 1) { fe = Math.pow(fe, ctx.nOpp); rho = 1 - Math.pow(1 - rho, ctx.nOpp); }
    let react = { s, B, need, FE: fe, rho, Wcall, Wraise, Wfold };
    react = ctx.prm.hooks.reaction({ seat: ctx.seat, street: ctx.street, s }, react);
    react.swC = ctx.H.table.sweep(react.Wcall, false);
    react.swR = acc > 0 ? ctx.H.table.sweep(react.Wraise, false) : null;
    // the opponent's raise: to B + f x (P + 2B) (§9), at most its stack
    const f = ctx.street === 1 ? eq.raiseF.flop : ctx.street === 2 ? eq.raiseF.turn : eq.raiseF.river;
    react.RT = Math.min(B + f * (P + 2 * B), ctx.effStack);
    react.callShare = tot ? (tot - wf - acc) / tot : 0; react.foldShare = tot ? wf / tot : 0; react.raiseShare = tot ? acc / tot : 0;
    return react;
  }
  /* the equity of combo i against the folding part, from E = share-weighted Ec, Er, Ef (no extra sweep) */
  function eqFold(ctx, rc, i, Ei) {
    const ec = rc.swC.eq[i], er = rc.swR ? rc.swR.eq[i] : 0;
    if (!(rc.foldShare > 0)) return null;
    const ef = (Ei - rc.callShare * (ec >= 0 ? ec : 0) - rc.raiseShare * (er >= 0 ? er : 0)) / rc.foldShare;
    return clamp(ef, 0, 1);
  }

  /* §8: the EV of each action for combo i, and why a bet would be made (null: no reason, the bet is not taken) */
  function evalCombo(ctx, i, a, b, reacts) {
    const eq = ctx.prm.equilibrium, P = ctx.P;
    const R = ctx.street === 3 ? eq.realize.river : ctx.ip ? eq.realize.ip : eq.realize.oop;
    const evCheck = R * a.E * P;
    const vEc = ctx.nOpp > 1 ? eq.multiwayValueEc : 0.5;
    const out = [];
    for (const rc of reacts) {
      // NaN: every combo of the calling / raising range shares a card with combo i (none of them can be there): no call / no raise against it
      const B = rc.B, Ec = rc.swC.eq[i], Er0 = rc.swR ? rc.swR.eq[i] : null, Er = Er0 >= 0 ? Er0 : null;
      const c = Math.max(0, 1 - rc.FE - rc.rho);
      const Rr = ctx.street === 3 ? 1 : R;
      // raised: fold (lose the bet) or call (equity against the raising range); the plan takes the better (§9 A)
      const RT = rc.RT, needR = (RT - B) / (P + 2 * RT);
      const vCallR = Er == null ? -B : Rr * Er * (P + 2 * RT) - RT;
      const vRaised = Math.max(-B, vCallR);
      const ev = rc.FE * P + c * (R * (Ec >= 0 ? Ec : 0) * (P + 2 * B) - B) + rc.rho * vRaised;
      // the reasons (§8's table)
      let reason = null;
      if ((b === 1 || b === 2) && Ec > vEc) reason = 'value';
      else if ((b === 2 || b === 3) && rc.s <= 0.34) { const ef = eqFold(ctx, rc, i, a.E); if (ef != null && 1 - ef >= eq.eqDenial.foldEq && Ec >= 0.5) reason = 'denial'; }
      if (!reason && b === 4 && ev > evCheck && !(ctx.nOpp > 1 && !(a.nutty >= 0.5))) reason = 'semibluff';
      if (!reason && b === 5 && rc.FE * P - (1 - rc.FE) * B > 0) reason = 'bluff';
      out.push({ s: rc.s, B, FE: rc.FE, rho: rc.rho, Ec, Er, needR, vRaised, EV: ev, reason });
    }
    return { evCheck, bets: out };
  }
  /* §8: the action probabilities of one combo, given the common shift delta (in chips) added to every bet's EV */
  function probs(ctx, ev, delta) {
    const tau = ctx.prm.equilibrium.tau * ctx.P;
    const opts = [{ k: -1, v: ev.evCheck }];
    ev.bets.forEach((x, k) => { if (x.reason) opts.push({ k, v: x.EV + delta }); });
    for (const o of opts) if (!(o.v === o.v)) o.v = -Infinity;   // (a NaN EV never wins)
    opts.sort((a, b) => b.v - a.v);
    const p = new Array(ev.bets.length + 1).fill(0);   // [check, size 0, size 1]
    const best = opts[0], second = opts[1];
    if (!second) { p[best.k + 1] = 1; return { p, d: Infinity }; }
    const d = best.v - second.v;
    if (d >= tau) p[best.k + 1] = 1;
    else { const q = 0.5 + 0.5 * d / tau; p[best.k + 1] = q; p[second.k + 1] = 1 - q; }
    return { p, d: d / ctx.P };
  }

  /* Step5 + Step6 + Step7 A: the bot's whole range is played through the node (to hold the frequency and the bluff shares), then its own hand */
  function betNode(ctx, s4) {
    const eq = ctx.prm.equilibrium, Wm = ctx.Wme, P = ctx.P;
    const reacts = s4.sizes.map(s => reaction(ctx, s));
    const combos = [];
    for (let i = 0; i < NC; i++) {
      if (!(Wm[i] > 0) || !(ctx.swMe.eq[i] >= 0)) continue;
      const a = attrs(ctx, i), b = bucketOf(ctx, a);
      combos.push({ i, w: Wm[i], a, b, ev: evalCombo(ctx, i, a, b, reacts) });
    }
    if (!combos.some(c => c.i === ctx.own)) {   // the bot's own hand is not in its range as the others see it (it played off its chart): add it with no weight
      const a = attrs(ctx, ctx.own), b = bucketOf(ctx, a);
      combos.push({ i: ctx.own, w: 0, a, b, ev: evalCombo(ctx, ctx.own, a, b, reacts) });
    }
    const nS = reacts.length;
    const ratio = s => (s * P) / (P + 2 * s * P);
    const capOf = s => ctx.street === 3 ? ratio(s) : Math.min(1, 2 * ratio(s));   // §8: the river's bluff share = B / (P + 2B); the flop and turn may hold more (twice, docs/decisions.md)
    const blk = c => { const rc = reacts[0]; let bc = 0, tc = 0, bf = 0, tf = 0; const a = CA[c.i], b = CB[c.i];
      for (let j = 0; j < NC; j++) { const wc = rc.Wcall[j] + rc.Wraise[j], wf = rc.Wfold[j]; if (!(wc > 0) && !(wf > 0)) continue; const hit = CA[j] === a || CA[j] === b || CB[j] === a || CB[j] === b; tc += wc; tf += wf; if (hit) { bc += wc; bf += wf; } }
      return { call: tc ? bc / tc : 0, fold: tf ? bf / tf : 0 }; };
    // the play of the whole range at a shift delta: per-combo probabilities, then the node's rules (slow-play, donk, multiway bluffs, bluff caps)
    let bluffBlk = null;
    const play = delta => {
      for (const c of combos) {
        const r = probs(ctx, c.ev, delta); c.p = r.p; c.d = r.d;
        if (s4.freq === 0) { c.p = c.p.map((x, k) => k === 0 ? 1 : 0); continue; }
        if (c.b === 1 && s4.slowB1 > 0) { const move = (1 - c.p[0]) * s4.slowB1; for (let k = 1; k <= nS; k++) c.p[k] *= 1 - s4.slowB1; c.p[0] += move; }   // §6: OOP keeps a share of B1 in its check range
        if (ctx.nOpp > 1 && c.b === 5) { const keep = eq.multiwayBluff; for (let k = 1; k <= nS; k++) { c.p[0] += c.p[k] * (1 - keep); c.p[k] *= keep; } }
      }
      // bluff caps per size, the bluffs with the best blockers kept first (§8, §10)
      for (let k = 1; k <= nS; k++) {
        let val = 0, bl = 0; const bluffs = [];
        for (const c of combos) { const x = c.w * c.p[k]; if (!x) continue; if (c.b === 5) { bl += x; bluffs.push(c); } else val += x; }
        const cap = capOf(reacts[k - 1].s); if (bl <= cap * (bl + val) || !bluffs.length) continue;
        let room = cap / (1 - cap) * val;
        if (!bluffBlk) { bluffBlk = new Map(); }
        for (const c of bluffs) if (!bluffBlk.has(c.i)) { const z = blk(c); bluffBlk.set(c.i, z.call - z.fold); }
        bluffs.sort((x, y) => bluffBlk.get(y.i) - bluffBlk.get(x.i));
        for (const c of bluffs) { const x = c.w * c.p[k]; if (room >= x) { room -= x; continue; } const keep = room > 0 ? room / x : 0; room = 0; c.p[0] += c.p[k] * (1 - keep); c.p[k] *= keep; }
      }
      let tw = 0, bw = 0; for (const c of combos) { tw += c.w; for (let k = 1; k <= nS; k++) bw += c.w * c.p[k]; }
      return tw ? bw / tw : 0;
    };
    // §8 step 5: the frequency within the target +-10pt, by the common shift delta (bisection), tau fixed
    let delta = eq.delta0 * P, F = play(delta), shifted = false;
    const tgt = s4.freq, tol = ctx.prm.design.freqTol;
    const dMax = eq.deltaMax * P;   // the shift is bounded (docs/decisions.md): it may move the border hands, not turn a clearly worse bet into a bet
    if (s4.freq > 0 && Math.abs(F - tgt) > tol) {
      let lo = -dMax, hi = dMax; shifted = true;
      for (let it = 0; it < 22; it++) { const mid = (lo + hi) / 2; const f = play(mid); if (f < tgt) lo = mid; else hi = mid; if (Math.abs(f - tgt) <= tol * 0.5) break; }
      delta = (lo + hi) / 2; F = play(delta);
    }
    // §8: a size with under 10% of the bet weight is folded into the other one
    let merged = null;
    if (nS === 2) {
      const w = [0, 0]; for (const c of combos) for (let k = 1; k <= 2; k++) w[k - 1] += c.w * c.p[k];
      const tot = w[0] + w[1];
      if (tot > 0) for (let k = 0; k < 2; k++) if (w[k] / tot < eq.minSizeShare) { merged = { from: s4.sizes[k], to: s4.sizes[1 - k] }; for (const c of combos) { c.p[2 - k] += c.p[k + 1]; c.p[k + 1] = 0; } break; }
    }
    const perSize = reacts.map((rc, k) => { let bw = 0, bl = 0; for (const c of combos) { const x = c.w * c.p[k + 1]; bw += x; if (c.b === 5) bl += x; } return { s: rc.s, weight: r3(bw / Math.max(1e-9, combos.reduce((a, c) => a + c.w, 0))), bluffShare: bw ? r3(bl / bw) : 0, cap: r3(capOf(rc.s)) }; });

    // the bot's own hand
    const me = combos.find(c => c.i === ctx.own);
    const u = ctx.rng(); let pick = 0, acc = 0; for (let k = 0; k <= nS; k++) { acc += me.p[k]; if (u < acc) { pick = k; break; } if (k === nS) pick = k; }
    if (!(me.p[pick] > 0)) pick = Math.max(0, me.p.indexOf(Math.max(...me.p.map(x => x || 0))));
    // Step5 record (§7, §12): the bot's hand
    let rank = 0, tw = 0; for (const c of combos) { tw += c.w; if (c.a.E > me.a.E) rank += c.w; }
    const z = blk(me);
    ctx.tr.step5 = { E: r3(me.a.E), bucket: me.b, D: r3(me.a.D), V: r3(me.a.V), nutty: r3(me.a.nutty), blockCall: r3(z.call), blockFold: r3(z.fold), rank: r3(tw ? rank / tw : 0),
      Er: me.ev.bets.map(x => r3(x.Er)), equityMode: ctx.H.mode };
    // Step6 record
    ctx.tr.step6 = {
      cands: [{ act: 'check', size: 0, EV: r3(me.ev.evCheck / ctx.bb) }].concat(me.ev.bets.map(x => ({ act: 'bet', size: r3(x.s), B: Math.round(x.B), FE: r3(x.FE), raise: r3(x.rho), Ec: r3(x.Ec), EV: r3((x.EV) / ctx.bb), EVshift: r3((x.EV + delta) / ctx.bb), reason: x.reason }))),
      deltaPot: me.d === Infinity ? null : r3(me.d), betWorse: pick > 0 && me.ev.bets[pick - 1].EV < me.ev.evCheck, tau: ctx.prm.equilibrium.tau, probs: me.p.map(r3), rnd: r3(u), chosen: pick === 0 ? { act: 'check' } : { act: 'bet', size: r3(reacts[pick - 1].s) },
      rangeFreq: r3(F), target: r3(tgt), shift: shifted ? r3(delta / P) : 0, merged, perSize };
    if (pick === 0) { ctx.tr.step7 = { kind: 'check' }; return { act: 'check' }; }
    // Step7 A (§9): the plan if raised
    const x = me.ev.bets[pick - 1];
    let plan;
    const strongDraw = me.b === 4 && me.a.D >= 0.3 && ctx.sprClass === 'low';
    if ((me.b === 1 && x.Er != null && x.Er >= Math.max(x.needR, 0.5) + 0.1) || strongDraw) plan = 'bet/3bet';
    else if (x.Er != null && x.Er >= x.needR) plan = 'bet/call';
    else plan = 'bet/fold';
    ctx.tr.step7 = { kind: 'plan', plan, Er: r3(x.Er), need: r3(x.needR), RT: Math.round(reacts[pick - 1].RT) };
    ctx.plan = plan;
    return { act: 'bet', B: x.B, s: x.s, plan };
  }

  /* Step7 B (§9): facing a bet or a raise. The ranges are already narrowed by the bet (index.js); R x E against them against the price */
  function facing(ctx) {
    const eq = ctx.prm.equilibrium, P = ctx.P, toCall = ctx.toCall, river = ctx.street === 3;
    const R = river ? eq.realize.river : ctx.ip ? eq.realize.ip : eq.realize.oop;
    const need = toCall / (P + toCall), margin = river ? eq.marginCall.river : eq.marginCall.flopTurn;
    const a = attrs(ctx, ctx.own), b = bucketOf(ctx, a);
    const RE = R * a.E;
    // the defence of the whole range at this price, for the MDF guard (§9 B 5): MDF = 1 - B / (P + B), B = the bet faced, P = the pot before it
    const Pb = P - toCall, mdf = 1 - toCall / (Pb + toCall);
    const Wm = ctx.Wme, em = ctx.swMe.eq; let tw = 0, dw = 0; const list = [];
    for (let i = 0; i < NC; i++) { if (!(Wm[i] > 0) || !(em[i] >= 0)) continue; tw += Wm[i]; const v = R * em[i]; list.push([v, Wm[i]]); if (v >= need + margin || em[i] >= eq.bucket.b1) dw += Wm[i]; }
    const defense = tw ? dw / tw : 0;
    let cut = need + margin, guard = false;
    if (defense < mdf - eq.mdfSlack && list.length) {   // too many folds: the border hands call again, down to MDF - 10pt
      list.sort((x, y) => y[0] - x[0]); let acc = 0; const want = (mdf - eq.mdfSlack) * tw;
      for (const [v, w] of list) { acc += w; if (acc >= want) { cut = Math.min(cut, v); break; } }
      // only the border hands come back (§9 B 5): at most mdfBorder under the price, so a hand far behind the narrowed range still folds (§9's example, docs/decisions.md)
      cut = Math.max(cut, need + margin - eq.mdfBorder);
      guard = true;
    }
    let act = RE >= cut || a.E >= eq.bucket.b1 ? 'call' : 'fold';
    // raise (§9 B 4): about B1 against the narrowed range, or a bluff with no showdown value whose blockers help and whose fold equity is high
    const f = ctx.street === 1 ? eq.raiseF.flop : ctx.street === 2 ? eq.raiseF.turn : eq.raiseF.river;
    let to = ctx.currentBet + f * (P + toCall);
    const after = ctx.stack - (to - ctx.myBet), potAfter = P + toCall + (to - ctx.myBet);
    const jam = after < potAfter || to - ctx.myBet >= ctx.stack;
    if (jam) to = ctx.stack + ctx.myBet;
    let raiseWhy = null, estFold = null;
    if (ctx.stack > toCall) {
      if (a.E >= eq.bucket.b1) raiseWhy = 'value';
      else if (ctx.nOpp === 1 && a.E < 0.25) {
        // the opponent's fold share against the raise: its combos whose equity against the bot's range is under the raise's price
        const add = to - ctx.currentBet, needO = add / (P + to - ctx.myBet + add);
        const Wo = ctx.Wop, eo = ctx.swOp.eq; let t = 0, fo = 0; for (let i = 0; i < NC; i++) { if (!(Wo[i] > 0) || !(eo[i] >= 0)) continue; t += Wo[i]; if (eo[i] < needO) fo += Wo[i]; }
        estFold = t ? fo / t : 0;
        const price = (to - ctx.myBet) / (P + (to - ctx.myBet));
        const mine = ctx.hole, Wb = ctx.Wop; let hit = 0, all = 0; for (let i = 0; i < NC; i++) { if (!(Wb[i] > 0)) continue; all += Wb[i]; if (mine.includes(CA[i]) || mine.includes(CB[i])) hit += Wb[i]; }
        if (estFold >= price + 0.1 && all && hit / all > 0.05 && ctx.rng() < 0.5) raiseWhy = 'bluff';
      }
    }
    if (raiseWhy) act = 'raise';
    ctx.tr.step5 = { E: r3(a.E), bucket: b, D: r3(a.D), V: r3(a.V), nutty: r3(a.nutty), blockCall: null, blockFold: null, rank: null, Er: null, equityMode: ctx.H.mode };
    ctx.tr.step6 = { facing: true, cands: [{ act: 'fold', EV: 0 }, { act: 'call', EV: r3((RE * (P + toCall) - toCall) / ctx.bb) }].concat(raiseWhy ? [{ act: 'raise', to: Math.round(to), reason: raiseWhy, estFold: r3(estFold) }] : []),
      chosen: { act }, probs: null, rnd: null };
    ctx.tr.step7 = { kind: 'facing', need: r3(need), margin, R, RE: r3(RE), cut: r3(cut), mdf: r3(mdf), defense: r3(defense), mdfGuard: guard, raiseWhy, raiseTo: raiseWhy ? Math.round(to) : null, estFold: r3(estFold) };
    return act === 'raise' ? { act: 'raise', to: Math.round(to) } : { act };
  }

  return { prepare, attrs, bucketOf, step2, step3, step4, reaction, probs, betNode, facing };
});
