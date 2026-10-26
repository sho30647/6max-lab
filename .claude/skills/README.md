# スキル一覧

## このアプリ専用（担当）
- `design` … 見た目・操作性
- `bot-strength` … ボットの判断を強くする
- `manager` … 全体の整理・振り分け・並行の判断
- `bot-lab` … 夜間のボット研究ループ（リングのポストフロップ。方針は `docs/bot-lab/policy.md`）

## 外から導入（汎用）
| スキル | 出どころ |
|---|---|
| brainstorming, writing-plans, executing-plans, systematic-debugging, test-driven-development, verification-before-completion, dispatching-parallel-agents, using-git-worktrees | https://github.com/obra/superpowers (MIT) |
| frontend-design, webapp-testing | https://github.com/anthropics/skills（各スキル内のLICENSE参照） |

他の外部スキルは、ブランチ `claude/skills-integration-keytb3` に残してある（このアプリに必要になったら追加する）。

## 専用エージェント（`.claude/agents/`）
スキルが「手順書」なのに対し、エージェントは、その手順書を持って別に動く担当者。会話を見ていないので、依頼文に経緯を書いて渡す。

| エージェント | 役割 | 土台のスキル |
|---|---|---|
| `design` | 見た目の変更。完了の条件に、変更前後のスクリーンショットを含む | `design` ＋ `docs/design-notes.md` |
| `bot-strength` | ボットの判断を数字で改善する（長いシミュレーションを会話から切り離す） | `bot-strength` |
| `reviewer` | 別の目での確認。**読むだけ**（編集ツールを持たない）。合否で返す | なし（`CLAUDE.md` の約束事） |
| `bot-judge` | 判断審査。ボットのハンドヒストリーを、ロジックと切り離して理論で評価（STEP0 情報チェック→1 役判定→2 レンジ→3 コンボ計算→4 結論）し、ずれがあれば原因と改善案（bot-strength 向け）を返す。情報が足りなければ質問1つで止まる。**読むだけ** | `docs/postflop_spec.md` ＋ 記録 `docs/hand_reviews.md` |

`manager` と `bot-lab` はエージェントにしない（`manager` は会話の相手である私の役割、`bot-lab` は夜間に自律で動く別セッション）。
