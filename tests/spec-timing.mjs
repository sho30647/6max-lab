// Spec bot: how long the hand-start work takes (docs/postflop_spec.md §0: the target is 0.5 s per decision).
// The flop's work = rank every runout (StreetTable) + one sweep per side with the next-card equities (E, D and V of every combo of both ranges).
// Measured in node and in Chromium, also with the CPU slowed 4x and 6x (Chrome DevTools' throttling: a mid-range / low-end phone).
// Only the combos of the two ranges are ranked; random ranges of 45% (an opening range) and 35% (a calling range) of the combos stand in for real ones.
// Usage: node tests/spec-timing.mjs
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bench = `
(function(){
  const C=SpecCards,E=SpecEquity; let s=99; const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x80000000;};
  const out={};
  for(const nb of [3,4,5]){
    const ts=[];
    for(let k=0;k<(nb===3?3:8);k++){
      const d=new Set(),board=[];while(board.length<nb){const c=(r()*52)|0;if(!d.has(c)){d.add(c);board.push(c);}}
      const A=new Float32Array(1326),B=new Float32Array(1326);for(let j=0;j<1326;j++){A[j]=r()<0.45?1:0;B[j]=r()<0.35?1:0;}
      const U=new Uint8Array(1326);for(let j=0;j<1326;j++)U[j]=A[j]>0||B[j]>0?1:0;
      const t0=performance.now(); const T=new E.StreetTable(board,U); const t1=performance.now();
      T.sweep(B,true); T.sweep(A,true); const t2=performance.now();
      const e0=performance.now(); for(let q=0;q<4;q++) T.sweep(B,false); const e1=performance.now();   // re-sweeps against other ranges (Ec, Er): 4 of them
      const m0=performance.now(); E.handVsRanges([board.length?((board[0]+1)%52):0,10],board.slice(),[B],5000,r); const m1=performance.now();
      ts.push([t1-t0,t2-t1,e1-e0,m1-m0]);
    }
    const med=i=>{const a=ts.map(x=>x[i]).sort((x,y)=>x-y);return Math.round(a[a.length>>1]);};
    out[nb===3?'flop':nb===4?'turn':'river']={rank:med(0),sweeps2:med(1),resweep4:med(2),mc5000:med(3),total:med(0)+med(1)+med(2)};
  }
  // the split plan (docs/postflop_spec.md §0, when the exact work does not fit): the bot's own hand exact (its E, D, V against the opponent's range),
  // the rest of both ranges from a sample of the flop's runouts (PER river cards for every turn card)
  for(const PER of [2,3,4]){
    const ts=[];
    for(let k=0;k<3;k++){
      const d=new Set(),board=[];while(board.length<3){const c=(r()*52)|0;if(!d.has(c)){d.add(c);board.push(c);}}
      const A=new Float32Array(1326),B=new Float32Array(1326);for(let j=0;j<1326;j++){A[j]=r()<0.45?1:0;B[j]=r()<0.35?1:0;}
      let me;do{me=(r()*1326)|0;}while(board.includes(C.CA[me])||board.includes(C.CB[me]));A[me]=1;
      const U=new Uint8Array(1326),O=new Uint8Array(1326);for(let j=0;j<1326;j++){U[j]=A[j]>0||B[j]>0?1:0;O[j]=B[j]>0?1:0;}O[me]=1;
      const t0=performance.now();
      E.handExact([C.CA[me],C.CB[me]],board,B);                                      // own hand: exact
      const T=new E.StreetTable(board,U,PER,r); T.sweep(B,true); T.sweep(A,true);      // both ranges: sampled
      for(let q=0;q<4;q++) T.sweep(B,false);
      ts.push(performance.now()-t0);
    }
    ts.sort((x,y)=>x-y); out['flopSplit'+PER]=Math.round(ts[1]);
  }
  return out;
})()`;
const vm = await import('vm');
const ctx = { performance, Math, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Set, Array };
ctx.self = ctx; vm.createContext(ctx);
for (const f of ['cards.js', 'equity.js']) vm.runInContext(fs.readFileSync(path.join(root, 'bot/spec', f), 'utf8'), ctx);
console.log('node      ', JSON.stringify(vm.runInContext(bench, ctx)));
// accuracy of the sampled ranges (node): mean |error| of E, D, V of the combos of a 35% range against a 45% range, against the exact table
{
  const C = require('../bot/spec/cards.js'), E = require('../bot/spec/equity.js');
  let s = 5; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
  for (const PER of [2, 3, 4]) {
    let eE = 0, eD = 0, eV = 0, n = 0, wD = 0, wV = 0;
    for (let k = 0; k < 4; k++) {
      const d = new Set(), board = []; while (board.length < 3) { const c = (r() * 52) | 0; if (!d.has(c)) { d.add(c); board.push(c); } }
      const A = new Float32Array(1326), B = new Float32Array(1326); for (let j = 0; j < 1326; j++) { A[j] = r() < 0.45 ? 1 : 0; B[j] = r() < 0.35 ? 1 : 0; }
      const U = new Uint8Array(1326); for (let j = 0; j < 1326; j++) U[j] = A[j] > 0 || B[j] > 0 ? 1 : 0;
      const ex = new E.StreetTable(board, U).sweep(A, true), sm = new E.StreetTable(board, U, PER, r).sweep(A, true);
      for (let i = 0; i < 1326; i++) {
        if (!(B[i] > 0) || isNaN(ex.eq[i])) continue;
        const a = E.devVul(ex, i, 0.8, 0.5), b = E.devVul(sm, i, 0.8, 0.5);
        eE += Math.abs(ex.eq[i] - sm.eq[i]); eD += Math.abs(a.D - b.D); eV += Math.abs(a.V - b.V); n++;
        if ((a.D >= 0.2) !== (b.D >= 0.2)) wD++; if (Math.abs(ex.eq[i] - sm.eq[i]) > 0.03) wV++;
      }
    }
    console.log(`sampled x${PER}: mean |err| E ${(eE / n * 100).toFixed(2)}pt, D ${(eD / n * 100).toFixed(2)}pt, V ${(eV / n * 100).toFixed(2)}pt; D on the wrong side of 20% ${(wD / n * 100).toFixed(1)}%, E off by more than 3pt ${(wV / n * 100).toFixed(1)}%`);
  }
}
const req = createRequire('/opt/node-tools/node_modules/');
const { chromium } = req('playwright');
const browser = await chromium.launch();
for (const rate of [1, 4, 6]) {
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  await page.setContent('<html><body></body></html>');
  for (const f of ['cards.js', 'equity.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'bot/spec', f), 'utf8') });
  console.log(`chromium x${rate}`, JSON.stringify(await page.evaluate(bench)));
  await page.close();
}
await browser.close();
