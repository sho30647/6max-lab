---
name: bot-strength
description: 6max-labのボットの判断ロジック（プリフロップ/ポストフロップのレンジ、ベットサイズ、ブラフ頻度、コール判定、プッシュ/フォールド）を強くする・直す担当。ボットの強さ、挙動、GTOとのズレ、シミュレーション結果に関する依頼で使う。見た目の依頼はdesignを使う。
---

# ボット強化担当

ボットの判断を改善する。**感覚ではなく、数字で良くなったことを示す**のが仕事。

## 場所
- ボットの判断：`index.html` の `botPreflop` `botPreflopRing` `botDecide` `botPostflopV3`（`botPostflopV2` は比較用に残してあるので消さない）。
- MTTの計算部：`mtt/core.js`（仕様は `docs/mtt-spec.md`）。プッシュ/フォールド表は `tools/pushfold.mjs`。
- 検証：`tests/` 配下。

## リングのポストフロップは新ボット（`bot/spec/`）が正
- 指示書は `docs/postflop_spec.md`。数字は `bot/spec/params.js` の1か所。旧ボット（`botPostflopV3`、v13）は比較用で、これからは直さない。
- 直す前に `docs/rebuild_report.md`（現状と次にやること）と `docs/decisions.md`（これまでの判断）を読む。
- 数字を変えたら、`docs/decisions.md` に理由と前後の数字を足す。指示書11章の区分①②③のうち、1回に1つだけ。
- 物差しは、新旧の対戦成績（`node tests/spec-eval.mjs`）より先に、理論値とのずれ：ブラフの比率（リバーなら B÷(P+2B)）、ベットを受けたときのフォールド率と降りすぎない目安（MDF）、打つ頻度と目標（`tests/spec-decisions.mjs` ほか）。対戦成績だけで数字を決めない（特定の相手への過学習を避ける）。
- 説明文（`bot/spec/explain.js`）と判断トレースは、ロジックを変えたら同じコミットで直す。「説明テンプレート未定義」が出ないこと（`tests/spec-decisions.mjs`）。
- テスト一式：`tests/spec-*.mjs`（`spec-handeval`、`spec-equity`、`spec-routing`、`spec-examples`、`spec-ranges`、`spec-stage0`、`spec-decisions`、`spec-trace`）と `ring-regression`。

## 進め方（この順で）
1. **変更前の数字を取る**。対象の挙動に合う測定を選ぶ：
   - **新ボット（リング）の対戦成績は `node tests/bot-eval.mjs full`**（6人卓の全配牌の重複対戦）。誤差が `--precision`（既定±3 bb/100）に縮むか `--minutes`（既定60分）が来るまで回し、最後に「強い／弱い／見分けられない」を1行で出す。止め方は誤差の幅だけで決めるので、途中で止めても偶然の差を「強い」と言うことはない。オールインは期待値で数える（`--raw` で実際の結果）。目安（4コア）：±3で約15分、±2で約30分、±1で約2時間。誤差を半分にするには4倍の量が要る。
   - ポストフロップの変更でも `full` でよい（プリフロップで終わる配牌は重複対戦で差がちょうど0になり、計算もほぼ0秒なので、除いても速くならない。実測では1対1のフロップだけの `postflop` より約1.8倍早く同じ誤差に届く）。`node tests/bot-eval.mjs postflop` は、どのライン（BTN対BBなど）で勝ち負けしているかの内訳を見るときに使う。
   - ボット同士の強さ比較：`node tests/mtt-bench-par.mjs <A> <B> [depths] [deals] [procs]`（同じ配札を席替えして2回打つ。結果は bb/100ハンド、正なら A が強い。標準誤差も見る）。新しい版は変種名として足して比べる。
   - リングゲームのボット同士：`node tests/ring-bench-par.mjs <A> <B> [deals] [procs] [seed]`（版は `BOT_TWEAKS` の番号。`6+riverBluff=4` のように調整を足した版も指定できる）。ベットを受けたときのフォールド率と、コールの実際の損益は `node tests/ring-bench.mjs stats <版> [hands]`。
   - リングのポストフロップを均衡に近づける作業は、`bot-lab` スキルの手順（エクスプロイト役のリーグ `node tests/ring-league.mjs`）で行う。方針は `docs/bot-lab/policy.md`。
   - 弱点を突く版を作ったら、その版に「突き返す版」（例：`<版>+riverBluff=4`）をぶつけ、新しい穴ができていないかも測る。
   - プリフロップ頻度：`node tests/mtt-bots.mjs`。
   - ブラフ比率など、ベットに含まれるハンドの内訳：`BACKLOG.md` にある12万ハンド規模の対戦シミュレーションと同じ指標で測る。
2. 原因を特定してから直す（「ブラフ候補が狭い」など、数字で説明できる原因）。
3. **変更後に同じ条件で数字を取り直す**。標準誤差の範囲内の差は「改善」と言わない。
4. 回帰テスト：エンジンやリングに触れたら `node tests/ring-regression.mjs` と `node tests/engine-nseat.mjs` は必須。`ring-baseline.json` は、挙動を意図して変えたときだけ `--save` で更新し、更新した理由を返答に書く。
5. `python3 tools/build-demo.py` でデモを作り、確認用リンクを出す。

## 守ること
- 強さの主張には必ず「前後の数字」「条件（深さ、ハンド数、シード）」「誤差」を添える。
- 理論値がある場合（例：ポットサイズ別のブラフ頻度）は、理論値と現状と変更後を並べる。
- 一度に1つの論点だけ変える。複数混ぜると、どれが効いたか分からない。
- ボットを強くしすぎて、練習相手として不自然になっていないかも一言触れる。

## 返答の形
現状 → 課題（数字で）→ 変更内容 → 前後の数字 → 残った論点、の順で簡潔に。

## 併用するスキル
- `systematic-debugging`：挙動のズレの原因を、直す前に特定する（進め方の2）。
- `test-driven-development`：直す前に、ズレを再現する測定やテストを先に用意する。
- `verification-before-completion`：「強くなった」と言う前に、変更後の数字を取り直して示す（進め方の3）。

これらは進め方のスキルで、**ポーカー理論は含まない**。理論値や「強いボットの基準」は、この手引きに書き足していく。
