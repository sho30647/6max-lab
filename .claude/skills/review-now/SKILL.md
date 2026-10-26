---
name: review-now
description: 夜間の判断審査（night-review）と同じ作業を、今から指定の時間だけ、1時間ごとの回として予約して回す。オーナーが「今からBot強化活動やって」「3時間ボット強化して」「今から審査回して」「手が離せない間にボットを鍛えて」と言ったときに使う。「Bot強化止めて」「強化活動やめて」で、残りの回を取り消すのにも使う。
---

# 今から回す判断審査（手動の回）

夜間の判断審査（`.claude/skills/night-review/SKILL.md`）と**同じ作業**を、今から1時間ごとに、新しいセッションで回す。この会話では作業をしない（予約するだけ）。各回は夜間と同じく、順番待ち（`docs/night-review/queue.json`）の続きから審査し、空なら新しく探す。**ボットも指示書も直さない。** 最後の回だけ、通知つきでレポートが届く。

## 始めるとき
1. **時間数 H を決める**：オーナーの言葉から読む（「3時間」→3）。言っていなければ 3。上限は 5。聞き返さない。
2. `TZ=Asia/Tokyo date` で今の時刻を確かめる。回の開始は、今から1分後、そのあと60分ごと（H回）。
3. **夜間と重ならないようにする**：最後の回の開始が、日本時間の 0:30〜6:00 に入るなら、0:30より前に始まる回だけに減らす（0回になるなら、「夜間の作業がもうすぐ始まるので、そちらに任せる」と伝えて終わる）。減らしたら、そのことを伝える。
4. **前の手動の回が残っていないか**：`mcp__claude-code-remote__list_triggers`（`enabled: true`）で、名前が「Bot強化（手動」で始まるものがあれば、新しく予約せず、「前の分がまだ動いている（最後の回は○時）」と伝える。オーナーが「やり直して」と言ったら、それを消してから予約する。
5. **作業記録の名前** L を決める：開始の日付と時刻（例：`2026-10-27-1400`）。
6. H回分を、`mcp__claude-code-remote__create_trigger` で1回ずつ予約する（ツールが見えなければ ToolSearch で読み込む）。
   - `name`：`Bot強化（手動 L k/H）`（k は何回目か）
   - `run_once_at`：その回の開始時刻（UTC の RFC3339。日本時間から9時間引く）
   - `create_new_session_on_fire`：true、`initiation`：`human_request`
   - `notifications`：最後の回だけ `{"push": true}`、ほかは `{}`
   - `prompt`：下の「指示文」に、L・k・H・最後の回かどうかを埋めたもの
7. オーナーへの返答（短く）：何回、何時から何時まで、レポートが届く時刻、止め方（「Bot強化止めて」）。質問はしない。

### 指示文（各回の prompt）
```
6max-lab（sho30647/6max-lab）の新ボットの判断審査を、手動の回として1回分実行してください（L の k/H 回目。最後の回：はい／いいえ）。

1. `git fetch origin` のあと、手順書 `.claude/skills/night-review/SKILL.md` を読んで、そのとおりに進めてください（作業ツリーに無ければ `git show origin/main:.claude/skills/night-review/SKILL.md` で読む）。これは手順書の「手動の回」です。作業記録の名前は `docs/night-review/L.md` を使ってください。
2. 手順書の 0 で作業ブランチ `claude/night-review-log` を新しく作るとき、`origin/staging` に `tests/spec-scan.mjs` がまだ無ければ、`origin/staging` ではなく `origin/claude/night-review` を土台にしてください。既にあるブランチに最新を取り込むときも、`tests/spec-scan.mjs` が staging に無いあいだは `origin/claude/night-review` を取り込んでください。
3. （最後の回でない）起動から50分以内に、コミットとpushまで済ませてください。最後の返答は手順書の「4. 回の最後の返答」の形（2〜3行）。
   （最後の回）起動から35分以内に審査を終え、残りでレポートを書き、50分以内にコミットとpushまで済ませてください。最後の返答は手順書の「5. 朝のレポート」の形（「朝の」は不要）。
4. 守ること：ボット（`bot/`）、画面（`index.html`、`mtt/`）、指示書（`docs/postflop_spec.md`）、`docs/decisions.md`、`params.js` は変えない。`main`・`staging` にマージしない。指示書の考え方を変える案は、採否を決めずにオーナーの判断事項として書く。
```
3. の2行は、その回に当てはまるほうだけを残す。

## 止めるとき（「Bot強化止めて」など）
1. `mcp__claude-code-remote__list_triggers`（`enabled: true`）で、名前が「Bot強化（手動」で始まるものを全部 `mcp__claude-code-remote__delete_trigger` で消す。夜間の予約（「夜間の判断審査」）は消さない。
2. 今動いている回は止めない（その回の分は記録が残る）。止めたい、と言われたときだけ、`mcp__claude-code-remote__list_sessions` で該当のセッションを探して `interrupt_session` する。
3. 返答：取り消した回の数と、記録はブランチ `claude/night-review-log` に残っていること。順番待ちの残りは、次の夜か次の手動の回が続きから審査する。
