// Flop-start duel: the new bot (spec) against the old bot (v13) from the flop on, heads-up, in the pots that the charts make.
// Why (docs/rebuild_report.md): in a full 6-max game only about a quarter of the deals reach a decision of the new bot, and the rest of the table adds noise.
// Here every sample is a heads-up flop: the two hands are drawn from the charts' ranges of the line (the opener's range x its later action, the caller's range),
// the flop, turn and river are drawn, and the pot and the stacks are what the line makes (100bb at the start). Each sample is played twice with the same
// cards and the same dice, the bots swapping seats (spec on the button / spec in the blinds), so the card luck cancels as in tests/spec-eval.mjs.
// The line plays out through the game's own engine from the flop (playHand(true)): the same betting rules, bet sanitising and settlement.
// Result: spec minus v13 in bb per flop played (the postflop difference of the line), per line and over the lines weighted by how often a 6-max deal
// reaches that heads-up flop (LINES, measured in natural play), and the same expressed per dealt hand (comparable to the all-deals figure of spec-eval).
// Usage: node tests/spec-duel.mjs [duels per process=2000] [processes=4] [first seed=1]
//        node tests/spec-duel.mjs --selftest   (v13 against v13 and spec against spec: both must be 0 +- noise)
import { spawn } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const self = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// heads-up flop lines: opener position, who it plays against, and the pot type. w = share of dealt hands that reach this flop (set from natural play)
export const LINES = [   // w: share of the dealt hands that reach this heads-up flop in natural play (3,000 deals, ring bots); 3BP: open = the opener (who calls), vs = the 3-bettor
  { name: 'SRP BTN vs BB', type: 'srp', open: 'BTN', vs: 'BB', w: 0.046 },
  { name: 'SRP CO vs BB', type: 'srp', open: 'CO', vs: 'BB', w: 0.042 },
  { name: 'SRP SB vs BB', type: 'srp', open: 'SB', vs: 'BB', w: 0.042 },
  { name: 'SRP HJ vs BB', type: 'srp', open: 'HJ', vs: 'BB', w: 0.038 },
  { name: 'SRP UTG vs BB', type: 'srp', open: 'UTG', vs: 'BB', w: 0.035 },
  { name: 'SRP UTG vs BTN', type: 'srp', open: 'UTG', vs: 'BTN', w: 0.012 },
  { name: 'SRP HJ vs BTN', type: 'srp', open: 'HJ', vs: 'BTN', w: 0.010 },
  { name: 'SRP HJ vs SB', type: 'srp', open: 'HJ', vs: 'SB', w: 0.008 },
  { name: 'SRP UTG vs SB', type: 'srp', open: 'UTG', vs: 'SB', w: 0.006 },
  { name: 'SRP CO vs BTN', type: 'srp', open: 'CO', vs: 'BTN', w: 0.006 },
  { name: 'SRP UTG vs CO', type: 'srp', open: 'UTG', vs: 'CO', w: 0.003 },
  { name: '3BP BTN vs SB', type: '3bp', open: 'BTN', vs: 'SB', w: 0.009 },
  { name: '3BP CO vs SB', type: '3bp', open: 'CO', vs: 'SB', w: 0.007 },
  { name: '3BP CO vs BTN', type: '3bp', open: 'CO', vs: 'BTN', w: 0.006 },
  { name: '3BP BTN vs BB', type: '3bp', open: 'BTN', vs: 'BB', w: 0.005 },
  { name: '3BP HJ vs CO', type: '3bp', open: 'HJ', vs: 'CO', w: 0.004 },
  { name: '3BP UTG vs HJ', type: '3bp', open: 'UTG', vs: 'HJ', w: 0.004 },
  { name: '3BP UTG vs CO', type: '3bp', open: 'UTG', vs: 'CO', w: 0.004 },
  { name: '3BP SB vs BB', type: '3bp', open: 'SB', vs: 'BB', w: 0.003 },
  { name: '3BP HJ vs SB', type: '3bp', open: 'HJ', vs: 'SB', w: 0.003 },
];

if (args[0] === '--worker' || args[0] === '--selftest-worker') {
  const { openGame } = await import('./spec-harness.mjs');
  const N = +args[1], SEED = +args[2], LW = JSON.parse(args[3]), MODE = args[4] || 'a';   // MODE: a = spec vs v13, 'oo' = v13 vs v13, 'ss' = spec vs spec
  const { browser, page, errors } = await openGame();
  const out = await page.evaluate(async ([N, SEED, LINES, MODE]) => {
    const POSN = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    const toSpot = T => { const r = new Map(), c = new Map(), j = new Map(); for (const k in T.h) { const x = T.h[k]; if (+x.r > 0) r.set(k, +x.r); if (+x.c > 0) c.set(k, +x.c); if (+x.j > 0) j.set(k, +x.j); } return { r, c, j, size: T.size }; };
    const spots = {};   // the chart spots of each line (what the game's bots read)
    for (const L of LINES) {
      const open = PFRanges.spot('open', L.open), vs = PFRanges.spot(L.type === 'srp' ? 'vsOpen' : 'vsOpen', L.vs + 'vs' + L.open);
      if (!open || !vs) { spots[L.name] = null; continue; }
      const o = toSpot(open), v = toSpot(vs);
      let v3 = null; if (L.type === '3bp') { const t = PFRanges.spot('vs3bet', L.open + 'vs' + L.vs); v3 = t ? toSpot(t) : null; }
      spots[L.name] = (L.type === '3bp' && !v3) ? null : { o, v, v3, openSize: open.size, tbSize: vs.size };
    }
    const wts = LINES.filter(L => spots[L.name]).map(L => L.w > 0 ? L.w : 0.01);
    const pickLine = u => { const act = LINES.filter(L => spots[L.name]); const tot = wts.reduce((a, b) => a + b, 0); let x = u * tot; for (let i = 0; i < act.length; i++) { x -= wts[i]; if (x <= 0) return act[i]; } return act[act.length - 1]; };
    const freq = (m, k) => m.get(k) || 0;
    const sample = (W, dead, u) => { let t = 0; for (let i = 0; i < 1326; i++) if (W[i] > 0 && !dead[SpecCards.CA[i]] && !dead[SpecCards.CB[i]]) t += W[i]; let x = u * t; for (let i = 0; i < 1326; i++) { if (!(W[i] > 0) || dead[SpecCards.CA[i]] || dead[SpecCards.CB[i]]) continue; x -= W[i]; if (x <= 0) return i; } return -1; };
    const weights = (L, who) => {   // who: 'op' or 'vs': the range of that player at the flop, as the game's charts give it (the line's actions multiplied)
      const sp = spots[L.name], W = new Float32Array(1326);
      for (let i = 0; i < 1326; i++) {
        const k = SpecCards.CLASS[i];
        if (L.type === 'srp') W[i] = who === 'op' ? Math.min(1, freq(sp.o.r, k) + freq(sp.o.j, k)) : freq(sp.v.c, k);
        else W[i] = who === 'op' ? Math.min(1, freq(sp.o.r, k) + freq(sp.o.j, k)) * freq(sp.v3.c, k) : Math.min(1, freq(sp.v.r, k) + freq(sp.v.j, k));
      }
      return W;
    };
    const rngW = {}; for (const L of LINES) if (spots[L.name]) rngW[L.name] = { op: weights(L, 'op'), vs: weights(L, 'vs') };
    // the dice: one stream for the cards (per sample), the game's Math.random for the bots, seeded the same in both plays
    const mul = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const seatOf = p => S.players.findIndex((q, i) => posOf(i) === p);
    async function play(L, card, vers) {   // vers: [version of the opener, version of the other player]
      const sp = spots[L.name];
      // seats: choose the button so that neither player sits in seat 0 (the hero seat)
      let b = 0; for (; b < 6; b++) { S.button = b; if (seatOf(L.open) !== 0 && seatOf(L.vs) !== 0) break; }
      S.button = b;
      const so = seatOf(L.open), sv = seatOf(L.vs), sb = seatOf('SB'), bbs = seatOf('BB');
      S.resetStacks = true;
      S.players.forEach(p => { p.stack = START; p.start = START; p.hole = []; p.folded = true; p.bet = 0; p.contrib = 0; p.allIn = false; p.acted = false; p.la = null; p.postAggr = 0; p.shown = false; p.reveal = false; p.raisedPre = false; p.called = false; p.called3 = false; p.rw = FULL_RANGE.slice(); p.rc = null; p.rw2 = FULL_RANGE.slice(); p.rc2 = null; p.rw3 = FULL_RANGE.slice(); p.rc3 = null; p.ante = 0; p.tw = null; p.ver = undefined; });
      S.players[so].ver = vers[0]; S.players[sv].ver = vers[1];
      const put = (s, amt) => { S.players[s].contrib += amt; S.players[s].stack -= amt; };
      // the pot the line makes (in chips; the big blind is 100)
      const open = Math.round(sp.openSize * BB), vsTo = L.type === '3bp' ? Math.round(sp.tbSize * BB) : 0;
      if (L.type === 'srp') { put(so, open); put(sv, open); }
      else { put(so, vsTo); put(sv, vsTo); }
      // the blinds: whoever of SB / BB is not one of the two has posted (and folded): a dead small / big blind
      for (const [s, amt] of [[sb, 50], [bbs, 100]]) if (s !== so && s !== sv) put(s, amt);
      S.players[so].folded = false; S.players[sv].folded = false;
      S.players[so].hole = card.hole[0]; S.players[sv].hole = card.hole[1];
      S.board = card.board.slice(); S.deck = card.deck.slice();
      S.street = 1; S.showdown = false; S.winners = []; S.done = false; S.lastActor = -1; S.soleWin = new Set(); S.shared = new Set(); S.heroDec = []; S.heroSaw = [true, true, false, false]; S.log = [[], [], [], []]; S.flopSeats = [so, sv];
      S.currentBet = 0; S.minRaise = BB; S.raiseCount = 0; S.pfAggr = L.type === 'srp' ? so : sv; S.lastAggr = -1; S.prevStreetAggr = -1; S.pfRaises = L.type === 'srp' ? 2 : 3;
      S.firstRaiser = so; S.threeBettor = L.type === '3bp' ? sv : -1; S.heroIPflop = null;
      S.players[so].raisedPre = true; if (L.type === '3bp') { S.players[sv].raisedPre = true; S.players[so].called3 = true; } else S.players[sv].called = true;
      // the preflop actions, as the game would have announced them (the new bot builds the ranges from these; the old bot's ranges the game builds with assignPreRange)
      SpecBot.newHand();
      const note = (s, act, spot, kind) => { SpecBot.onAction(s, { street: 0, act, to: 0, potBefore: 0, toCall: 0, allIn: false, pre: { spot, kind } }); };
      if (L.type === 'srp') {
        note(so, 'raise', sp.o, 'open'); note(sv, 'call', sp.v, 'vsOpen');
        assignPreRange(so, 'raise', { sp: sp.o, kind: 'open' }); assignPreRange(sv, 'call', { sp: sp.v, kind: 'vsOpen' });
      } else {
        note(so, 'raise', sp.o, 'open'); note(sv, 'raise', sp.v, 'vsOpen'); note(so, 'call', sp.v3, 'vs3');
        assignPreRange(so, 'call', { sp: sp.v3, kind: 'vs3' }); assignPreRange(sv, 'raise', { sp: sp.v, kind: 'vsOpen' });
      }
      S.cursor = (S.button + 1) % 6;
      await playHand(true);
      const lh = SpecBot.lastHand;   // the new bot's decisions of this play (when a spec bot is in it)
      return { net: S.players.map(p => (p.stack - START) / BB), recs: lh ? lh.records.map(r => ({ pt: r.step0.potType, k: r.step0.nodeKind, fb: r.other.fallback, st: r.street })) : [] };
    }
    const rows = [];
    for (let k = 0; k < N; k++) {
      const rand = mul(SEED * 100003 + k * 7919), L = pickLine(rand());
      // the cards of this sample: the opener's hand, the other's hand, the flop, turn and river, then the rest of the deck in a fixed order
      const dead = new Uint8Array(52); const wo = rngW[L.name].op, wv = rngW[L.name].vs;
      const io = sample(wo, dead, rand()); if (io < 0) continue; dead[SpecCards.CA[io]] = dead[SpecCards.CB[io]] = 1;
      const iv = sample(wv, dead, rand()); if (iv < 0) continue; dead[SpecCards.CA[iv]] = dead[SpecCards.CB[iv]] = 1;
      const rest = []; for (let c = 0; c < 52; c++) if (!dead[c]) rest.push(c);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      const hole = [[SpecCards.CA[io], SpecCards.CB[io]], [SpecCards.CA[iv], SpecCards.CB[iv]]];
      const board = rest.slice(0, 3);   // the flop
      const deck = rest.slice(3).reverse();   // S.deck.pop() deals: the turn and the river come off the end
      const card = { hole, board, deck };
      const A = MODE === 'oo' ? 13 : 'spec', B = MODE === 'ss' ? 'spec' : 13;
      // play 1: A is the opener, B the other player;  play 2: B the opener, A the other (the same cards in the same seats)
      __seed(SEED * 7919 + k * 13); const r1 = await play(L, card, [A, B]);
      const seats = [seatOf(L.open), seatOf(L.vs)];   // the button (so the seats) is the same in both plays
      __seed(SEED * 7919 + k * 13); const r2 = await play(L, card, [B, A]);
      const a1 = r1.net[seats[0]], a2 = r2.net[seats[1]];   // A's result: as the opener in play 1, as the other player in play 2
      const sum = r1.net.reduce((a, x) => a + x, 0) + r2.net.reduce((a, x) => a + x, 0);   // chips are conserved: 0
      const recs = r1.recs.concat(r2.recs);
      rows.push({ line: L.name, d: (a1 + a2) / 2, a1, a2, sum, spec: recs.filter(r => !r.fb).length, fb: recs.filter(r => r.fb).length, pt: recs.length ? recs[0].pt : null, k1: recs.length ? recs[0].k : null });
      if (__hands.length > 50) __hands.length = 0;
    }
    return rows;
  }, [N, SEED, LW, MODE]);
  console.log('RESULT ' + JSON.stringify({ rows: out, errors: errors.slice(0, 3) }));
  await browser.close();
  process.exit(0);
}

// ---- the main process: runs the workers and pools the rows ----
const selftest = args[0] === '--selftest';
const [duels = '2000', procs = '4', seed0 = '1'] = selftest ? ['300', '4', '1'] : args;
const weights = JSON.stringify(LINES);
const modes = selftest ? ['oo', 'ss'] : ['a'];
const t0 = Date.now();
for (const mode of modes) {
  const runs = Array.from({ length: +procs }, (_, i) => new Promise((res, rej) => {
    const c = spawn('node', [self, '--worker', duels, String(+seed0 + i), weights, mode]); let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d);
    c.on('close', () => { const l = out.split('\n').find(x => x.startsWith('RESULT ')); l ? res(JSON.parse(l.slice(7))) : rej(new Error(out.slice(-600))); });
  }));
  const all = await Promise.all(runs);
  const rows = all.flatMap(x => x.rows), errs = all.flatMap(x => x.errors);
  const stat = rs => { const n = rs.length; if (!n) return { n, mean: 0, se: 0 }; const m = rs.reduce((a, r) => a + r.d, 0) / n; const sd = Math.sqrt(rs.reduce((a, r) => a + (r.d - m) ** 2, 0) / Math.max(1, n - 1)); return { n, mean: m, se: sd / Math.sqrt(n) }; };
  const f = x => `${(x.mean * 100).toFixed(1)} ± ${(196 * x.se).toFixed(1)}`;
  const byLine = {}; for (const r of rows) (byLine[r.line] = byLine[r.line] || []).push(r);
  console.log(`${mode === 'a' ? 'spec minus v13' : mode === 'oo' ? 'SELFTEST v13 minus v13 (must be 0)' : 'SELFTEST spec minus spec (must be 0)'}: bb per 100 flops played (95% interval), ${rows.length} heads-up flops (each played twice, seats swapped), ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const L of LINES) { const x = stat(byLine[L.name] || []); if (x.n) console.log(`  ${L.name.padEnd(16)} n=${String(x.n).padStart(5)}  ${f(x)}`); }
  // pooled: every line weighted by its share of the dealt hands (LINES[].w, 0 = the sample's own share)
  const wsum = LINES.reduce((a, L) => a + (byLine[L.name] ? (L.w || 0) : 0), 0);
  const tot = stat(rows);
  console.log(`  all lines, as sampled:   ${f(tot)}   (SE ${(tot.se * 100).toFixed(1)})`);
  if (wsum > 0) {
    let m = 0, v = 0; for (const L of LINES) { const x = stat(byLine[L.name] || []); if (!x.n || !L.w) continue; const w = L.w / wsum; m += w * x.mean; v += w * w * x.se * x.se; }
    console.log(`  all lines, weighted by how often a dealt hand reaches the flop heads-up in that line: ${(m * 100).toFixed(1)} ± ${(196 * Math.sqrt(v)).toFixed(1)} bb/100 flops;  per dealt hand (x ${wsum.toFixed(3)} of the deals): ${(m * wsum * 100).toFixed(1)} ± ${(196 * Math.sqrt(v) * wsum).toFixed(1)} bb/100 hands`);
  }
  const badSum = rows.filter(r => Math.abs(r.sum) > 1e-6).length, noSpec = rows.filter(r => mode !== 'oo' && r.spec === 0).length, fbs = rows.reduce((a, r) => a + r.fb, 0), nd = rows.reduce((a, r) => a + r.spec, 0);
  const wrongPt = rows.filter(r => r.pt && r.pt !== (r.line.startsWith('SRP') ? 'SRP' : '3BP')).length;
  console.log(`  checks: chips not conserved in ${badSum} samples; samples with no decision of the new bot ${noSpec}; new-bot decisions ${nd}, handed to the old bot ${fbs}; pot type in the trace wrong in ${wrongPt}`);
  if (badSum || wrongPt || fbs) process.exitCode = 1;
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  console.log('RESULT ' + JSON.stringify({ mode, tot, n: rows.length }));
}
