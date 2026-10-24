#!/usr/bin/env python3
"""Cross-check of the spec bot's equity engine (bot/spec/equity.js) against eval7 (an independent evaluator).
usage: pip install eval7; python3 tools/equity_crosscheck.py [spots=40]
Node writes random river and turn spots with the bot's exact equities (one hand against a random weighted range);
this script recomputes every one of them by brute force with eval7.evaluate and prints the largest difference."""
import json, subprocess, sys, os
import eval7

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
js = r"""
const C=require('./bot/spec/cards.js'),E=require('./bot/spec/equity.js');
let s=7;const r=()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x80000000;};
const out=[];
for(let k=0;k<%d;k++){
  const nb=k%%2?4:5,d=new Set(),board=[];while(board.length<nb){const c=(r()*52)|0;if(!d.has(c)){d.add(c);board.push(c);}}
  const W=new Float32Array(1326);for(let j=0;j<1326;j++)W[j]=r()<0.3?Math.round(r()*100)/100:0;
  const sw=new E.StreetTable(board).sweep(W,false);
  let i;do{i=(r()*1326)|0;}while(board.includes(C.CA[i])||board.includes(C.CB[i]));
  const rng=[];for(let j=0;j<1326;j++)if(W[j]>0)rng.push([C.cardStr(C.CA[j])+C.cardStr(C.CB[j]),W[j]]);
  out.push({board:board.map(C.cardStr),hand:[C.cardStr(C.CA[i]),C.cardStr(C.CB[i])],range:rng,eq:sw.eq[i]});
}
console.log(JSON.stringify(out));
""" % n
spots = json.loads(subprocess.check_output(['node', '-e', js], cwd=root))
SUIT = {'s': 's', 'h': 'h', 'd': 'd', 'c': 'c'}
card = lambda s: eval7.Card(s[0] + SUIT[s[1]])
deck = [r + s for r in '23456789TJQKA' for s in 'shdc']
worst = 0.0
for sp in spots:
    board = [card(c) for c in sp['board']]; hand = [card(c) for c in sp['hand']]
    used = set(sp['board'] + sp['hand'])
    runouts = [[]] if len(board) == 5 else [[c] for c in deck if c not in used]
    win = tot = 0.0
    for ro in runouts:
        bd = board + [card(c) for c in ro]; u2 = used | set(ro)
        my = eval7.evaluate(hand + bd)
        for combo, w in sp['range']:
            a, b = combo[:2], combo[2:]
            if a in u2 or b in u2: continue
            v = eval7.evaluate([card(a), card(b)] + bd)
            win += w * (1 if my > v else 0.5 if my == v else 0); tot += w
    eq = win / tot
    worst = max(worst, abs(eq - sp['eq']))
print(f'{len(spots)} spots, largest difference from eval7: {worst:.2e}')
sys.exit(0 if worst < 1e-4 else 1)
