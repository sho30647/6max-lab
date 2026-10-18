/* AI coach (dev only).
   Loaded ONLY by tools/build-demo.py (the Artifact demo); index.html never references this file, so production has no AI and
   there is no second copy of the app to keep in step. It reads the game through the page's globals (S, CH, posOf, ...)
   and asks Claude through the Artifact `sample` capability (the viewer's own Claude account; nothing to pay on the API side). */
(function(){
'use strict';
if(!window.claude||typeof window.claude.use!=='function') return;   // not inside an Artifact: do nothing

const STREETS=['プリフロップ','フロップ','ターン','リバー'];
const OPEN_POS=['UTG','HJ','CO','BTN','SB'];
const QUICK=[
  ['他のポジションだと？','このハンドの戦略は、他のポジションだとどう変わる？'],
  ['ベットサイズを変えると？','いまのスポットでベットサイズを変えると、相手の応答はどう変わる？'],
  ['いまの最善手は？','いまのスポットでの最善手と理由を教えて。']
];
const hist=[];   // [{q,a}] the last few turns of this panel
let busy=false, ctl=null, sample=null;

const fmtBB=x=>(Math.round(x/BB*100)/100)+'bb';
const cs=c=>cardStr(c);

function tableContext(){
  if(typeof S==='undefined'||!S.players||!S.players.length||!S.players[0].hole||S.players[0].hole.length<2) return null;
  const h=S.players[0];
  const live=S.players.map((p,i)=>({p,i})).filter(x=>!x.p.folded);
  const lines=[];
  lines.push('【いまの卓】リングゲーム（6max、ブラインド0.5/1bb）。金額はすべてbb。');
  lines.push('ストリート: '+STREETS[Math.min(S.street||0,3)]+(S.board.length?'　ボード: '+S.board.map(cs).join(' '):'（ボードなし）'));
  lines.push('あなた(ヒーロー)のハンド: '+h.hole.map(cs).join(' ')+'　ポジション: '+posOf(0)+(h.folded?'（フォールド済み）':''));
  lines.push('ポット: '+fmtBB(potTotal())+'　ヒーローがコールに必要な額: '+fmtBB(Math.max(0,S.currentBet-h.bet)));
  lines.push('各プレイヤー（ホールカードは非公開。ヒーローには分からない）:');
  S.players.forEach((p,i)=>lines.push('  '+posOf(i)+(i===0?'(あなた)':'('+p.name+')')+'　スタック'+fmtBB(p.stack)+(p.folded?'　フォールド':'')+(p.bet?'　今のベット'+fmtBB(p.bet):'')));
  const log=(S.log||[]).map((a,i)=>a&&a.filter(Boolean).length?STREETS[i]+': '+a.filter(Boolean).join(', '):null).filter(Boolean);
  if(log.length) lines.push('ここまでのアクション（*はヒーロー、f=フォールド、c=コール、r=レイズ/ベット）:\n'+log.join('\n'));
  lines.push('アクティブな相手: '+live.filter(x=>x.i!==0).map(x=>posOf(x.i)).join(', ')+(S.running?'':'　（ハンドは終了済み）'));
  return lines.join('\n');
}

/* ---------- tools: numbers come from the app itself, not from the model's memory ---------- */
function normHand(s){
  s=String(s||'').trim(); const m=s.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i); if(!m) return null;
  let a=m[1].toUpperCase(), b=m[2].toUpperCase(), t=m[3].toLowerCase();
  if(RANKS.indexOf(b)>RANKS.indexOf(a)) [a,b]=[b,a];
  return a===b?a+b:a+b+(t||'o');
}
const freqOf=(sp,k)=>sp?{raise:+(sp.r.get(k)||0).toFixed(2),call:+(sp.c.get(k)||0).toFixed(2),jam:+(sp.j.get(k)||0).toFixed(2)}:null;
function vsOpenSpot(pos,op){   // same mapping as the bots (preSituation, one raise already)
  if(pos==='BB') return CH.vsOpen.BB[op]||null;
  if(pos==='SB') return op==='BTN'?CH.vsOpen.SBvsBTN:op==='CO'?CH.vsOpen.SBvsCO:CH.vsOpen.SBearly;
  if(pos==='BTN') return op==='CO'?CH.vsOpen.BTNvsCO:op==='HJ'?CH.vsOpen.BTNvsHJ:CH.vsOpen.IPearly;
  if(pos==='CO'&&op==='HJ') return CH.vsOpen.IPearly;
  return CH.vsOpen.IPearlyTight;
}
function preflopLookup(inp){
  const k=normHand(inp.hand); if(!k) return {error:'ハンドは AKs / QJo / 77 の形式で指定してください'};
  const spot=inp.spot||'open';
  if(spot==='open'){ const o={}; (inp.positions&&inp.positions.length?inp.positions:OPEN_POS).forEach(p=>{ o[p]=freqOf(CH.open[p],k); }); return {hand:k,spot:'open（最初にオープンできる場面。raise=オープンの頻度）',freq:o}; }
  if(spot==='vsOpen'){ const pos=inp.position||'BB', ops=inp.versus&&inp.versus.length?inp.versus:['UTG','HJ','CO','BTN','SB'].filter(p=>p!==pos); const o={}; ops.forEach(op=>{ o[op]=freqOf(vsOpenSpot(pos,op),k); }); return {hand:k,spot:pos+'がオープンに直面（raise=3ベット、call=コール）',freq:o}; }
  if(spot==='vs3bet'){ const op=inp.position||'BTN', th=inp.versus&&inp.versus.length?inp.versus:Object.keys(CH.vs3[op]||{}); const o={}; th.forEach(t=>{ o[t]=freqOf((CH.vs3[op]||{})[t],k); }); return {hand:k,spot:op+'のオープンに3ベットが来た場面（raise=4ベット、call=コール、jam=オールイン）',freq:o}; }
  return {error:'spot は open / vsOpen / vs3bet のどれか'};
}
function botResponse(inp){
  const h=S.players[0];
  if(S.board.length<3) return {error:'ポストフロップ専用です（ボードがまだありません）'};
  if(h.folded) return {error:'ヒーローはフォールド済みです'};
  if(S.currentBet-h.bet>0) return {error:'ヒーローは既にベットに直面しています。この道具は「ヒーローが先にベットしたら」の場面用です'};
  const pot0=potTotal(), sizes=(inp.sizes_pct_of_pot&&inp.sizes_pct_of_pot.length?inp.sizes_pct_of_pot:[33,50,75,100,150]).slice(0,8);
  const bots=S.players.map((p,i)=>({p,i})).filter(x=>x.i>0&&!x.p.folded&&(inp.position==null||posOf(x.i)===inp.position));
  if(!bots.length) return {error:'対象の相手がいません'};
  const nLive=S.players.filter(p=>!p.folded).length;
  return {note:'継続率はボットの判断ロジックの「降りない条件」（ポットオッズとレンジ内の強さの順位）から出した目安で、実際のボットはこれにランダム性とブラフ・レイズが加わる。ホールカードは含まない。',
    pot_bb:+(pot0/BB).toFixed(2), hero_stack_bb:+(h.stack/BB).toFixed(1),
    opponents:bots.map(({p,i})=>{
      const t=rangeTable(p), eq=equity(0,[p],300), n=nLive-1;
      return {position:posOf(i), style:p.style&&p.style.name||p.name, stack_bb:+(p.stack/BB).toFixed(1), hero_equity_vs_range_pct:Math.round(eq*100),
        by_size:sizes.map(pc=>{
          const B=Math.min(Math.round(pot0*pc/100),h.stack), pot=pot0+B, alpha=B/pot, foldCut=Math.pow(alpha,1/Math.max(1,n)), potOdds=B/(pot+B);
          let keep=0; t.items.forEach(it=>{ if(it.q>=foldCut) keep+=it.w; });
          return {size_pct_pot:pc, bet_bb:+(B/BB).toFixed(1), all_in:B>=h.stack, pot_odds_needed_pct:Math.round(potOdds*100), est_continue_pct_of_range:t.tot?Math.round(keep/t.tot*100):null};
        })};
    })};
}
const TOOLS=[
  {name:'preflop_lookup', description:'このアプリのプリフロップ・チャートから、指定ハンドの頻度(0〜1)を引く。別ポジション・別の相手への比較に使う。',
   inputSchema:{type:'object',properties:{hand:{type:'string',description:'例: AKs, QJo, 77'},spot:{type:'string',enum:['open','vsOpen','vs3bet'],description:'open=最初のオープン / vsOpen=相手のオープンに直面 / vs3bet=自分のオープンに3ベット'},position:{type:'string',description:'vsOpenでは自分のポジション、vs3betではオープンしたポジション'},positions:{type:'array',items:{type:'string'},description:'openで見るポジション（省略時は全部）'},versus:{type:'array',items:{type:'string'},description:'相手のポジション（省略時は全部）'}},required:['hand']},
   execute:preflopLookup},
  {name:'bot_response', description:'ヒーローがいまベットしたら、相手のボットがどれくらい降りずに継続するかを、ベットサイズ別(ポットの%)に出す。ポストフロップでヒーローが先に動く場面用。',
   inputSchema:{type:'object',properties:{sizes_pct_of_pot:{type:'array',items:{type:'number'},description:'例 [33,50,75,100,150]'},position:{type:'string',description:'特定の相手だけ見るとき'}}},
   execute:botResponse}
];

/* ---------- UI ---------- */
function injectCSS(){
  const st=document.createElement('style');
  st.textContent=`
#aiFab{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:90;border:0;border-radius:999px;padding:10px 16px;font:600 14px/1 system-ui,sans-serif;background:var(--ink);color:var(--bg);box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer}
#aiPanel{position:fixed;left:0;right:0;bottom:0;z-index:95;max-height:78vh;display:none;flex-direction:column;background:var(--surface);color:var(--ink);border-top:1px solid var(--line);box-shadow:0 -6px 24px rgba(0,0,0,.35);padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px))}
#aiPanel.open{display:flex}
@media (min-width:700px){#aiPanel{left:auto;right:12px;bottom:12px;width:440px;border:1px solid var(--line);border-radius:14px}}
#aiPanel header{display:flex;align-items:center;justify-content:space-between;font-weight:700;margin-bottom:6px}
#aiPanel header button{border:0;background:none;color:var(--muted);font-size:20px;cursor:pointer}
#aiCtx{font-size:12px;color:var(--muted);margin-bottom:6px}
#aiLog{overflow:auto;flex:1;min-height:60px;font-size:14px;line-height:1.55}
#aiLog .q{font-weight:700;margin-top:8px}
#aiLog .a{white-space:pre-wrap;margin:2px 0 6px}
#aiLog .e{color:var(--loss)}
#aiQuick{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
#aiQuick button{border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer}
#aiForm{display:flex;gap:6px}
#aiForm textarea{flex:1;resize:none;height:44px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
#aiForm button{border:0;border-radius:8px;padding:0 14px;background:var(--ink);color:var(--bg);font-weight:700;cursor:pointer}
#aiForm button:disabled{opacity:.5}`;
  document.head.appendChild(st);
}
const $=id=>document.getElementById(id);
function build(){
  injectCSS();
  const fab=document.createElement('button'); fab.id='aiFab'; fab.type='button'; fab.textContent='🤖 AIに質問';
  const panel=document.createElement('div'); panel.id='aiPanel';
  panel.innerHTML='<header><span>AIコーチ（デモ専用）</span><button type="button" id="aiClose" aria-label="閉じる">×</button></header><div id="aiCtx"></div><div id="aiLog"></div><div id="aiQuick"></div><form id="aiForm"><textarea id="aiQ" placeholder="例：このハンドをCOで持っていたら？"></textarea><button id="aiSend" type="submit">送信</button></form>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  QUICK.forEach(([label,q])=>{ const b=document.createElement('button'); b.type='button'; b.textContent=label; b.onclick=()=>ask(q); $('aiQuick').appendChild(b); });
  fab.onclick=()=>{ panel.classList.add('open'); fab.style.display='none'; refreshCtx(); $('aiQ').focus(); };
  $('aiClose').onclick=()=>{ panel.classList.remove('open'); fab.style.display=''; };
  $('aiForm').onsubmit=e=>{ e.preventDefault(); const q=$('aiQ').value.trim(); if(q) ask(q); };
  $('aiQ').addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){ e.preventDefault(); $('aiForm').requestSubmit(); } });
}
function refreshCtx(){ const c=tableContext(); $('aiCtx').textContent=c?('いまの卓を読み取り中：'+S.players[0].hole.map(cs).join(' ')+'（'+posOf(0)+'）'+(S.board.length?' ボード '+S.board.map(cs).join(' '):'')):'ハンドが始まっていません（一般的な質問は可能）'; }

const SYSTEM=`あなたは、ノーリミットホールデム6max(100bb前後)のポーカーコーチ。ユーザーは自分のアプリで練習中で、そのアプリのボットと戦っている。
- 日本語で、結論を最初に。次に理由。必要なら具体例。長くしすぎない。
- 数字(頻度・継続率・エクイティ)は推測せず、道具(preflop_lookup, bot_response)で取る。道具の値はこのアプリのチャートとボット用ロジックの近似であり、厳密なGTOではないと一言添える。
- 相手のホールカードは分からない前提で、レンジで語る。
- 道具で取れない部分は、一般的なポーカー理論として答え、そう分かるように書く。`;

async function ask(q){
  if(busy) return; busy=true; $('aiSend').disabled=true;
  const log=$('aiLog'); const qe=document.createElement('div'); qe.className='q'; qe.textContent='Q. '+q; const ae=document.createElement('div'); ae.className='a'; ae.textContent='考え中…';
  log.appendChild(qe); log.appendChild(ae); log.scrollTop=log.scrollHeight; $('aiQ').value=''; refreshCtx();
  const ctx=tableContext();
  const prompt=SYSTEM+'\n\n'+(ctx||'（ハンドは始まっていない。一般的な質問として答える）')+(hist.length?'\n\n【これまでのやりとり】\n'+hist.slice(-3).map(h=>'Q:'+h.q+'\nA:'+h.a).join('\n'):'')+'\n\n【質問】'+q;
  try{
    ctl=new AbortController();
    const r=await sample(prompt,{tools:TOOLS,cache:false,signal:ctl.signal,onText:({text})=>{ ae.textContent=text; log.scrollTop=log.scrollHeight; }});
    ae.textContent=r.text; hist.push({q,a:r.text.slice(0,1500)});
  }catch(e){
    ae.className='a e'; ae.textContent=e&&e.code==='not_granted'?'許可されませんでした。もう一度送ると、許可を求める画面が出ます。':e&&e.code==='rate_limited'?'回数制限にかかりました。少し待ってからもう一度。':'エラー: '+((e&&e.message)||e);
  }finally{ busy=false; $('aiSend').disabled=false; ctl=null; log.scrollTop=log.scrollHeight; }
}

window.claude.use('sample').then(s=>{ if(!s) return; sample=s; build(); window.AI_COACH={tableContext,tools:TOOLS}; }).catch(()=>{});
})();
