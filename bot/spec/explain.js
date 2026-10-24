/* Spec bot (docs/postflop_spec.md §12): the explanation of one decision, made from its trace only, by fixed templates (no AI, no reasons added afterwards).
   Every step has a "fact" line (the numbers and what they measure) and a "judgement" line (what they mean), the words chosen from the numbers
   by §12's table (params.explainWords). A branch with no template says so ("説明テンプレート未定義") and is listed in result.undefined.
   explain(trace, params) -> {text, lines, undefined: [..]}.
   Works in the browser (window.SpecExplain) and in node (require). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.SpecExplain = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RANKS = '23456789TJQKA', SUIT = ['♠', '♥', '♦', '♣'];
  const card = c => RANKS[c >> 2] + SUIT[c & 3];
  const cards = a => a.map(card).join('');
  const pct = x => x == null || isNaN(x) ? '?' : Math.round(x * 100) + '%';
  const pt = x => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 1000) / 10) + 'pt';
  const bb = (chips, b) => (Math.round(chips / b * 10) / 10) + 'bb';
  const STREET = ['プリフロップ', 'フロップ', 'ターン', 'リバー'];
  const POT = { SRP: 'シングルレイズポット（SRP）', '3BP': '3ベットポット', '4BP': '4ベット以上のポット', LIMP: 'リンプポット' };
  const BUCKET = ['', 'ナッツ級', 'バリュー', 'マージナル', 'ドロー', 'エア'];
  const HIGH = { A: 'Aハイ', KQ: 'K・Qハイ', JT: 'J・Tハイ', '9-': '9以下のローボード' };
  const CONN = { none: '連結なし', semi: 'やや連結（半連結）', high: '連結が強い（高連結）' };
  const SUITW = { rainbow: 'スートはバラバラ（レインボー）', two: '同じスートが2枚（ツートーン）', mono: '同じスートが3枚以上（モノトーン）' };
  const PAIR = { none: 'ペアなし', pair: 'ペアボード', trips: '同じランクが3枚' };
  const NEWCARD = { blank: 'どちらのレンジもほぼ強くならないカード（ブランク）', over: 'それまでの最高位より上のカード（オーバーカード）', flush: '同じスートの3枚目（フラッシュが完成しうる）', straight: 'ストレートが完成しうるカード', pair: 'ボードにペアができるカード' };
  const KIND = { callBet: 'ベットへのコール', raiseBet: 'レイズ', checkAggr: 'アグレッサーのチェック', checkBackIP: 'IPのチェックバック', checkOOPCaller: 'OOP側のチェック（アグレッサーではない側。ドンクをほぼ打たないので絞らない）', betSmall: '小さいベット（ポットの75%未満）', betBig: '大きいベット（ポットの75%以上）' };
  const NODE = {
    cbet: ['自分がアグレッサー（前のストリートで最後に打った側）', 'CB・バレル（アグレッサーが続けて打つ）を打つかどうかの局面'],
    donk: ['相手がアグレッサーで、ボットが先に行動する', 'ドンク（アグレッサーより先に打つベット）の局面。原則はチェック'],
    probe: ['前のストリートはチェックで回り、ボットが先に行動する', 'プローブ（相手のチェックでレンジの上限が抑えられた前提で打つベット）の局面'],
    delayed: ['前のストリートはチェックで回り、ボットが後に行動する', 'ディレイド（1ストリート遅れて打つベット）の局面'],
    stab: ['アグレッサーの相手がこのストリートでチェックしてきた', '相手のチェックを受けて打つかどうかの局面（スタブ）'],
    facingBet: ['相手がベットしてきた', 'コール・フォールド・レイズを選ぶ局面'],
    facingRaise: ['相手がレイズしてきた', 'レイズに対してコール・フォールド・リレイズを選ぶ局面']
  };
  const LEGACY = { 'legacy:limp': 'リンプが入ったポットなので', 'legacy:cold3': 'コールドコーラー（またはスクイーズ）が入った3ベット以上のポットなので', error: '計算中にエラーが起きたので', stage0: '新ボットの実装前なので', stage2: '新ボットの実装前なので', passThrough: 'テスト用に旧ボットへ素通しする設定なので' };
  const pick = (table, x) => { for (const [lo, w] of table) if (x >= lo) return w; return table[table.length - 1][1]; };

  function explain(tr, prm) {
    const W = prm.explainWords, und = [], L = [];
    const missing = (step, key) => { und.push(step + ':' + key); return `説明テンプレート未定義（${step}：${key}）`; };
    const s0 = tr.step0 || {}, b = s0.bb || 100;
    const oppName = s0.nPlayers > 2 ? '相手たち' : (tr.oppPos || '相手');
    L.push(`【${STREET[tr.street]}：${tr.pos}のボット、${cards(tr.hole)} / ボード ${cards(tr.board)}】`);
    // the conclusion: the action the game applied (the bot's answer after the game's rounding), its size
    const ap = tr.applied || tr.decision || {};
    let concl;
    if (ap.act === 'check') concl = 'チェック';
    else if (ap.act === 'fold') concl = 'フォールド';
    else if (ap.act === 'call') concl = `コール（${bb(s0.toCall, b)}）` + (ap.allIn ? '・オールイン' : '');
    else if (ap.act === 'bet') concl = `ポットの${pct((ap.to) / s0.pot)}をベット（${bb(ap.to, b)}）` + (ap.allIn ? '・オールイン' : '');
    else if (ap.act === 'raise') concl = `${bb(ap.to, b)}にレイズ` + (ap.allIn ? '（オールイン）' : '');
    else concl = missing('結論', String(ap.act));
    L.push('結論：' + concl, '');
    if (tr.other && tr.other.fallback) {
      L.push('① 状況', `  事実：${POT[s0.potType] || s0.potType}。ボットは${tr.pos}。`, `  判断：${LEGACY[tr.other.fallback] ? LEGACY[tr.other.fallback] + '、この判断は旧ボットに任せた。' : missing('旧ボット', tr.other.fallback)}`);
      return { text: L.join('\n'), lines: L, undefined: und };
    }
    // ① Step0
    const node = NODE[s0.nodeKind];
    const sprW = s0.sprClass === 'low' ? 'スタックが浅く（SPR 2未満）、このハンドで全額を入れる展開になりやすい' : s0.sprClass === 'mid' ? 'スタックは中くらい（SPR 2〜6）で、残りのストリートで全額が入ることもある' : 'スタックが深く（SPR 6超）、このハンドで全額を入れる展開ではない';
    L.push('① 状況',
      `  事実：${POT[s0.potType] || s0.potType}。ボットは${tr.pos}（${s0.ip ? 'IP：後に行動する側' : 'OOP：先に行動する側'}）。${node ? node[0] : ''}。SPR（有効スタック÷ポット）は約${Math.round(s0.spr * 10) / 10}。${s0.nPlayers > 2 ? `このポットには${s0.nPlayers}人いる。` : ''}`,
      `  判断：${node ? node[1] : missing('Step0', s0.nodeKind)}。${sprW}。${s0.nPlayers > 2 ? '3人以上なのでマルチウェイの簡易ルール（ブラフを減らし、バリューの基準を上げる）を使う。' : ''}`);
    // ② Step1
    const s1 = tr.step1;
    if (!s1) L.push('② これまでの行動とレンジ', '  ' + missing('Step1', 'none'));
    else {
      const sh = a => `ナッツ級${pct(a[0])}・バリュー${pct(a[1])}・マージナル${pct(a[2])}・ドロー${pct(a[3])}・エア${pct(a[4])}`;
      const opps = s1.applied.filter(u => u.seat !== tr.seat && u.act !== 'fold' && u.before);
      const facts = opps.map(u => `${u.pos || '相手'}の${KIND[u.kind] || u.kind}で、レンジの各バケットに倍率（${u.mult.map(m => m).join('／')}）を掛けた`);
      const o = s1.opp[0];
      L.push('② これまでの行動とレンジ',
        `  事実：${facts.length ? facts.join('。') + '。' : '前の判断のあと、相手のレンジを絞る行動はなかった。'}${o ? `${oppName}の今のレンジ：${sh(o.now)}。` : ''}`);
      let j = '相手のレンジの構成は大きくは変わっていない';
      if (opps.length) { const u = opps[opps.length - 1], up = (u.after[0] + u.after[1]) - (u.before[0] + u.before[1]); j = up > 0.05 ? `相手のレンジは強い手に寄った（ナッツ級＋バリューが${pct(u.before[0] + u.before[1])}→${pct(u.after[0] + u.after[1])}）` : up < -0.05 ? `相手のレンジは弱い手に寄った（ナッツ級＋バリューが${pct(u.before[0] + u.before[1])}→${pct(u.after[0] + u.after[1])}）` : j; }
      L.push(`  判断：${j}。以降の勝率は、この絞り込んだレンジに対して計算する。`);
    }
    // ③ Step2
    const s2 = tr.step2;
    if (!s2) L.push('③ ボード', '  ' + missing('Step2', 'none'));
    else {
      const nc = s2.newCard ? `新しいカードは${s2.newCard.map(x => NEWCARD[x] || x).join('、')}。` : '';
      const dynF = s2.dynScore == null ? '' : `次のカードでボットのレンジの平均勝率が5pt以上動くのは、全体の${pct(s2.dynScore)}のカード。`;
      L.push('③ ボード', `  事実：${HIGH[s2.high] || s2.high}、${CONN[s2.conn] || s2.conn}、${SUITW[s2.suit] || s2.suit}、${PAIR[s2.pair] || s2.pair}。${nc}${dynF}`);
      const dj = s2.dyn == null ? 'リバーなので、次のカードはない' : (W.dyn[s2.dyn] ? `${W.dyn[s2.dyn]}「${s2.dyn === 'static' ? '静的' : s2.dyn === 'dynamic' ? '動的' : '中間'}」なボード` : missing('Step2', s2.dyn));
      L.push(`  判断：${dj}。`);
    }
    // ④ Step3
    const s3 = tr.step3;
    if (!s3) L.push('④ 有利不利', '  ' + missing('Step3', 'none'));
    else {
      const oop = s0.ip ? '' : `OOPなのでエクイティを実現しにくい分3ptを引き、実効のレンジ優位は${pt(s3.raEff)}。`;
      let nt = '';
      if (s3.nutsTop && s3.nutsTop.mine.length) {
        const m = s3.nutsTop.mine.map(x => x.cls).join('・');
        const keep = s3.nutsTop.mine.filter(x => x.oppNow != null).map(x => `${x.cls}は${pct(x.oppNow)}`).join('、');
        nt = `ボットの最強クラスの手の中心は${m}。` + (keep ? `${oppName}の今のレンジには、${keep}が残っている（同じクラスの全コンボを100%としたとき）。` : '');
      }
      L.push('④ 有利不利',
        `  事実：ボットのレンジの${oppName}のレンジに対する平均勝率は${pct(0.5 + s3.ra)}（レンジ優位 ${pt(s3.ra)}）。${oop}相手に80%以上勝てる手の割合は、ボット${pct(s3.nutsMine)}、${oppName}${pct(s3.nutsOpp)}（ナッツ優位 ${pt(s3.na)}）。${nt}`,
        `  判断：${pick(W.ra, s3.raEff)}。${pick(W.na, s3.na)}。${s3.checkFlag ? '（検算：Aハイ・Kハイのボードでプリフロップのレイザーが不利と出たため、レンジの読み込みを確認する対象）' : ''}`);
    }
    // ⑤ Step4
    const s4 = tr.step4;
    if (!s4) L.push('⑤ 打ち方の方針', '  ' + missing('Step4', 'none'));
    else if (s4.facing) L.push('⑤ 打ち方の方針', '  事実：相手のベット（レイズ）を受けている。', '  判断：打ち方の方針（頻度とサイズ）は決めず、⑦の手順でコール・フォールド・レイズを決める。');
    else {
      const ADJ = { oop: 'OOPなので頻度を一段下げた', static: '静的なボードなのでサイズを一段小さくした', dynamic: '動的なボードなのでサイズを一段大きく、頻度を一段下げた', turn: 'ターンなのでサイズを一段大きくした', river: 'リバーなのでサイズを二段大きくした', lowSpr: 'SPRが低いので、オールインまでのサイズを候補に入れた', donkCheck: 'ドンクの局面で、有利なカードが落ちていないので打たない', donkOpen: 'ドンクの局面だが、有利なカードが落ちたので打つことも考える' };
      const adj = s4.adjust.map(a => ADJ[a] || missing('Step4', a)).join('。');
      L.push('⑤ 打ち方の方針',
        `  事実：レンジ優位とナッツ優位から補間した目標ベット頻度は${pct(s4.freq)}（補正後）、サイズはポットの${pct(s4.sizeRaw)}。候補サイズは${s4.sizes.map(pct).join('と')}。${adj ? '補正：' + adj + '。' : ''}${s4.slowB1 ? `OOPなので、ナッツ級の手の${pct(s4.slowB1)}はチェックに残す。` : ''}`);
      let j;
      if (s4.freq === 0) j = 'この局面では打たない（全体でチェック）';
      else if (s4.freq >= 0.6 && s4.sizeRaw <= 0.4) j = '小さいサイズで、レンジの広い範囲を打つのが基本方針';
      else if (s4.freq >= 0.6) j = '高い頻度で、中くらいのサイズで打つのが基本方針';
      else if (s4.freq <= 0.4 && s4.sizeRaw >= 0.7) j = '強い手とブラフに絞り、大きいサイズで打つのが基本方針';
      else if (s4.freq <= 0.2) j = 'チェックを中心にし、打つなら中くらいのサイズ';
      else j = '中くらいの頻度とサイズで打つのが基本方針';
      L.push(`  判断：${j}。`);
    }
    // ⑥ Step5
    const s5 = tr.step5;
    if (!s5) L.push('⑥ このハンドの強さ', '  ' + missing('Step5', 'none'));
    else {
      const river = tr.street === 3;
      const blk = s5.blockCall != null ? `ボットの2枚は、相手のコールする手の${pct(s5.blockCall)}、降りる手の${pct(s5.blockFold)}を消している（ブロッカー）。` : '';
      const rk = s5.rank != null ? `ボットのレンジの中では上から${pct(s5.rank)}の位置。` : '';
      L.push('⑥ このハンドの強さ',
        `  事実：${oppName}の今のレンジに対する勝率${pct(s5.E)}。${river ? '' : `次のカードで勝率が80%以上に上がる確率${pct(s5.D)}、50%未満に下がる確率${pct(s5.V)}。`}${rk}${blk}${s5.equityMode && s5.equityMode !== 'exact' ? '（この手の勝率は厳密計算、レンジのほかの手は近似）' : ''}`);
      const bw = W.bucket[s5.bucket] ? `${W.bucket[s5.bucket]}「${BUCKET[s5.bucket]}」帯` : missing('Step5', 'bucket' + s5.bucket);
      L.push(`  判断：${bw}。${river ? 'リバーなので、この先強くなることも逆転されることもない' : `${pick(W.D, s5.D)}。${pick(W.V, s5.V)}`}。`);
    }
    // ⑦ Step6, ⑧ Step7
    const s6 = tr.step6, s7 = tr.step7;
    if (!s6) L.push('⑦ アクションの比較', '  ' + missing('Step6', 'none'));
    else if (s6.facing) {
      const call = s6.cands.find(c => c.act === 'call'), r = s6.cands.find(c => c.act === 'raise');
      L.push('⑦ アクションの比較',
        `  事実：コールに必要な勝率${pct(s7.need)}${s7.margin ? `（後のストリートで追加の支払いを迫られる分、${Math.round(s7.margin * 100)}ptを上乗せして${pct(s7.need + s7.margin)}）` : ''}。実現率${s7.R}×勝率で${pct(s7.RE)}。コールの期待値は約${call.EV}bb。${r ? `レイズするなら${bb(r.to, b)}まで。` : ''}`);
      let j;
      if (s6.chosen.act === 'raise') j = s7.raiseWhy === 'value' ? '絞り込んだレンジに対してもナッツ級なので、レイズして価値を取る' : s7.raiseWhy === 'bluff' ? `ショーダウンで勝てる見込みがなく、相手が降りる割合（推定${pct(s7.estFold)}）が高いので、ブラフでレイズする` : missing('Step7', 'raise:' + s7.raiseWhy);
      else if (s6.chosen.act === 'call') j = s7.mdfGuard && s7.RE < s7.need + s7.margin ? `勝率だけなら足りないが、降りすぎを防ぐ基準（下の⑧）でコールに回す` : '必要な勝率を上回るのでコールする';
      else j = '必要な勝率を下回るのでフォールドする（すでにポットに入れたチップは判断に入れない）';
      L.push(`  判断：${j}。`);
      L.push('⑧ 降りすぎの確認（MDFガード）',
        `  事実：ボットのレンジのうち、この価格で続ける手は${pct(s7.defense)}。降りすぎない目安（MDF：1 − ベット÷(ベット前のポット＋ベット)）は${pct(s7.mdf)}。`,
        `  判断：${s7.mdfGuard ? `目安を10pt以上下回るので、境界の手（必要な勝率より最大10pt低い手まで）をコールに戻した（基準を${pct(s7.cut)}まで下げた）` : '目安を大きくは下回らないので、基準はそのまま'}。`);
    } else {
      const bets = s6.cands.filter(c => c.act === 'bet');
      const REASON = { value: 'コールしてくる手にも勝っているので、ベットがバリューとして機能する', denial: '降りる手が持っている勝率を消せるので、エクイティ否定の小さいベットが成り立つ', semibluff: '降りてもらう分と、コールされた後に強くなる見込みを合わせると、チェックより得', bluff: '降りてもらうだけで得になるので、ブラフとして打てる' };
      const facts = bets.map(c => `ポットの${pct(c.size)}ベットでは、${oppName}のレンジの${pct(c.FE)}が降り、${pct(c.raise)}がレイズし、コールしてくる手に対する勝率は${pct(c.Ec)}`).join('。');
      const evs = [`チェック${s6.cands[0].EV}bb`].concat(bets.map(c => `${pct(c.size)}ベット${c.EV}bb`)).join('、');
      L.push('⑦ アクションの比較', `  事実：${facts}。期待値は${evs}。${s6.shift ? `レンジ全体のベット頻度を目標（${pct(s6.target)}）に近づけるため、ベットの期待値に一律でポットの${pct(s6.shift)}を足して比べた（調整後の頻度${pct(s6.rangeFreq)}）。` : ''}${s6.deltaPot != null ? `${s6.shift ? '調整後の' : ''}1番目と2番目の差はポットの約${pct(s6.deltaPot)}。` : ''}${s6.merged ? `ポットの${pct(s6.merged.from)}のサイズを使う手がベット全体の10%未満なので、${pct(s6.merged.to)}にまとめた。` : ''}`);
      const ch = s6.chosen; const best = ch.act === 'bet' ? bets.find(c => c.size === ch.size) : null;
      let j = [];
      if (best) { j.push(best.reason === 'value' ? pick(W.Ec, best.Ec) : (REASON[best.reason] || missing('Step6', 'reason:' + best.reason))); if (best.reason !== 'value') j.push(pick(W.Ec, best.Ec)); }
      else { const why = bets.every(c => !c.reason) ? 'どのサイズでも、ベットする理由（バリュー・エクイティ否定・セミブラフ・ブラフ）が成り立たないのでチェック' : 'チェックの期待値のほうが高い（または確率でチェックを選んだ）'; j.push(why); }
      const mixed = s6.probs && s6.probs.filter(x => x > 0).length > 1;
      if (s6.betWorse) j.push('期待値だけならチェックが上だが、レンジ全体の頻度合わせ（上の一律の上乗せ）でベットを選んだ');
      j.push(mixed ? `${W.delta.mixed}（チェック${pct(s6.probs[0])}・ベット${pct(1 - s6.probs[0])}）。乱数${s6.rnd}で${ch.act === 'bet' ? 'ベット' : 'チェック'}を選んだ` : W.delta.pure);
      L.push(`  判断：${j.join('。')}。`);
      if (!s7) L.push('⑧ レイズされた場合', '  ' + missing('Step7', 'none'));
      else if (s7.kind === 'check') L.push('⑧ レイズされた場合', '  事実：チェックしたので、レイズされる場面はない。', '  判断：相手がベットしてきたら、そのとき⑦の手順（コールに必要な勝率との比較）で決める。');
      else if (s7.kind === 'plan') {
        const PLAN = { 'bet/fold': 'レイズされたら降りる（bet/fold）', 'bet/call': 'レイズされても必要な勝率を上回るので、コールする（bet/call）', 'bet/3bet': 'レイズされたら、さらにレイズ（オールインを含む）する（bet/3bet）' };
        L.push('⑧ レイズされた場合', `  事実：${oppName}のレイズレンジ（${bb(s7.RT, b)}へのレイズを想定）に対する勝率${pct(s7.Er)}、コールに必要な勝率${pct(s7.need)}。`, `  判断：${PLAN[s7.plan] || missing('Step7', s7.plan)}。`);
      } else L.push('⑧ レイズされた場合', '  ' + missing('Step7', s7.kind));
    }
    return { text: L.join('\n'), lines: L, undefined: und };
  }
  return { explain };
});
