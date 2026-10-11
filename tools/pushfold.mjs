// Computes chip-EV push/fold equilibrium widths for 8-max with a big-blind ante (BB ante = 1bb), one shove / call decision per player.
// Usage: node tools/pushfold.mjs [samples] > out.json   (equity matrix is cached in tools/.eqcache.json)
// Model: stacks equal (d bb), blinds 0.5/1, ante 1 posted by the BB. A shover is called by at most one player (the first caller in action order);
// every seat's shove and call set is found by damped best-response iteration. Hands are ranked by their own all-in equity, not by a fixed list.
import fs from 'fs';
const SAMPLES = +process.argv[2] || 1500, CACHE = new URL('./.eqcache.json', import.meta.url).pathname;
const R = '23456789TJQKA';
// 169 classes: [hiRank, loRank, suited]
const CL = []; for (let a = 12; a >= 0; a--) for (let b = a; b >= 0; b--) { if (a === b) CL.push([a, b, 0]); else { CL.push([a, b, 1]); CL.push([a, b, 0]); } }
const W = CL.map(([a, b, s]) => a === b ? 6 : s ? 4 : 12);
// 7-card evaluator
function ev7(c) {
  const rc = new Int8Array(13), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  for (let i = 0; i < 7; i++) { const r = c[i] >> 2, s = c[i] & 3; rc[r]++; sc[s]++; sm[s] |= 1 << r; }
  let fm = 0; for (let s = 0; s < 4; s++) if (sc[s] >= 5) fm = sm[s];
  const str = m => { m |= (m & (1 << 12)) ? 1 << -1 + 0 : 0; let all = m | ((m >> 12) & 1); for (let t = 12; t >= 4; t--) { const w = 31 << (t - 4); if ((m & w) === w) return t; } if ((m & 0x100F) === 0x100F) return 3; return -1; };
  if (fm) { const t = str(fm); if (t >= 0) return 8e7 + t; }
  let q = -1, t3 = -1, p1 = -1, p2 = -1; const kick = [];
  for (let r = 12; r >= 0; r--) { const n = rc[r]; if (n === 4) q = r; else if (n === 3) { if (t3 < 0) t3 = r; else if (p1 < 0) p1 = r; } else if (n === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; } }
  const hi = (x, ex) => { let k = 0, v = 0; for (let r = 12; r >= 0 && k < x; r--) if (rc[r] > 0 && !ex.includes(r)) { v = v * 13 + r; k++; } return v; };
  if (q >= 0) return 7e7 + q * 13 + hi(1, [q]);
  if (t3 >= 0 && p1 >= 0) return 6e7 + t3 * 13 + p1;
  if (fm) { let v = 0, k = 0; for (let r = 12; r >= 0 && k < 5; r--) if (fm & (1 << r)) { v = v * 13 + r; k++; } return 5e7 + v; }
  let m = 0; for (let r = 0; r < 13; r++) if (rc[r]) m |= 1 << r; const t = str(m); if (t >= 0) return 4e7 + t;
  if (t3 >= 0) return 3e7 + t3 * 1e4 + hi(2, [t3]);
  if (p1 >= 0 && p2 >= 0) return 2e7 + p1 * 169 + p2 * 13 + hi(1, [p1, p2]);
  if (p1 >= 0) return 1e7 + p1 * 3e4 + hi(3, [p1]);
  return hi(5, []);
}
let EQ;
if (fs.existsSync(CACHE)) EQ = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
else {
  EQ = Array.from({ length: 169 }, () => new Array(169).fill(0.5));
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = ([a, b, s]) => { let sa, sb; if (a === b) { sa = (rnd() * 4) | 0; do sb = (rnd() * 4) | 0; while (sb === sa); } else if (s) { sa = sb = (rnd() * 4) | 0; } else { sa = (rnd() * 4) | 0; do sb = (rnd() * 4) | 0; while (sb === sa); } return [a * 4 + sa, b * 4 + sb]; };
  const buf = new Int8Array(7), used = new Uint8Array(52);
  for (let i = 0; i < 169; i++) for (let j = i; j < 169; j++) {
    let w = 0, n = 0;
    while (n < SAMPLES) {
      const [a, b] = pick(CL[i]), [c, d] = pick(CL[j]); if (a === c || a === d || b === c || b === d) continue;
      used.fill(0); used[a] = used[b] = used[c] = used[d] = 1; const bd = [];
      while (bd.length < 5) { const x = (rnd() * 52) | 0; if (!used[x]) { used[x] = 1; bd.push(x); } }
      const e1 = ev7([a, b, ...bd]), e2 = ev7([c, d, ...bd]); w += e1 > e2 ? 1 : e1 === e2 ? 0.5 : 0; n++;
    }
    EQ[i][j] = w / n; EQ[j][i] = 1 - w / n;
  }
  fs.writeFileSync(CACHE, JSON.stringify(EQ));
}
// equity of each hand against a (weighted) range, computed as a matrix-vector product
const vsRange = (rg) => { let tot = 0; for (let j = 0; j < 169; j++) tot += rg[j] * W[j]; const out = new Float64Array(169); if (tot <= 0) return out.fill(0.5); for (let i = 0; i < 169; i++) { let s = 0; for (let j = 0; j < 169; j++) s += rg[j] * W[j] * EQ[i][j]; out[i] = s / tot; } return out; };
const frac = rg => { let a = 0, t = 0; for (let j = 0; j < 169; j++) { a += rg[j] * W[j]; t += W[j]; } return a / t; };
// seats: 0 = UTG ... n-2 = SB, n-1 = BB. Everyone has d bb behind, SB posts 0.5, BB posts 1 + the ante 1.
function solve(n, d) {
  const SBi = n - 2, BBi = n - 1, post = i => i === SBi ? 0.5 : i === BBi ? 2 : 0, DEAD = 2.5;
  const push = Array.from({ length: n - 1 }, () => new Float64Array(169).fill(0.3)), call = Array.from({ length: n }, () => new Float64Array(169).fill(0.3));
  for (let it = 0; it < 300; it++) {
    const damp = 1 / (2 + it * 0.1);
    const pf = push.map(frac), cf = call.map(x => frac(x));
    const nc = Array(n).fill(null);
    for (let j = 1; j < n; j++) {
      // the range a shover has, seen from seat j: mixture over earlier seats p (p shoves, everyone before folds, nobody between p and j calls)
      const mix = new Float64Array(169); let P = 0, ws = 0;
      for (let p = 0; p < j; p++) {
        let w = 1; for (let k = 0; k < p; k++) w *= 1 - pf[k]; for (let k = p + 1; k < j; k++) w *= 1 - cf[k];
        const wp = w * pf[p]; P += wp * (2 * d + DEAD - post(p) - post(j)); ws += wp;
        for (let h = 0; h < 169; h++) mix[h] += w * push[p][h];
      }
      if (ws <= 1e-12) { nc[j] = new Float64Array(169); continue; }
      P /= ws; const eq = vsRange(mix), set = new Float64Array(169);
      for (let h = 0; h < 169; h++) set[h] = (eq[h] * P - d) > -post(j) ? 1 : 0;
      nc[j] = set;
    }
    for (let j = 1; j < n; j++) for (let h = 0; h < 169; h++) call[j][h] += damp * (nc[j][h] - call[j][h]);
    const cf2 = call.map(x => frac(x));
    for (let p = 0; p < n - 1; p++) {
      const ev = new Float64Array(169); let reach = 1;
      for (let j = p + 1; j < n; j++) {
        const q = cf2[j]; if (q > 0) { const eq = vsRange(call[j]), pot = 2 * d + DEAD - post(p) - post(j); for (let h = 0; h < 169; h++) ev[h] += reach * q * (eq[h] * pot - d); }
        reach *= 1 - q;
      }
      for (let h = 0; h < 169; h++) { const win = ev[h] + reach * (DEAD - post(p)); push[p][h] += damp * ((win > -post(p) ? 1 : 0) - push[p][h]); }
    }
  }
  return push.map(frac);
}
const depths = [3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 20, 25];
const res = {}; for (const d of depths) { const w = solve(8, d); res[d] = w.map(x => +(x * 100).toFixed(1)); }
console.log(JSON.stringify(res));
