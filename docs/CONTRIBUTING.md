# 共同開発ガイド（友人 + Claude 向け）

Claude Code（またはClaudeアプリのコードセッション）でこのリポジトリを開き、最初に **「CLAUDE.md と docs/CONTRIBUTING.md を読んで」** と伝えると、ルールが入る。

## 構成
- `index.html` … アプリ本体（リング + プリフロップ練習 + MTTの接続部）。1ファイル。
- `mtt/core.js` … MTTの計算部（UMD）。仕様は `docs/mtt-spec.md`。
- `tests/` … Playwrightで画面を動かす回帰テスト（`node tests/xxx.mjs`）。リングの挙動は `ring-regression.mjs` と `ring-baseline.json` で固定している。変えてよいのは挙動を意図して変えるときだけ。
- `dev/ai-coach.js` … デモ専用のAIコーチ（Artifactの `sample` 機能で、閲覧者自身のClaudeに質問する）。`tools/build-demo.py` がデモにだけ差し込み、`index.html` は参照しない。本番にAIは出ない。
- `tools/build-demo.py` … 現在のブランチを、Firebaseを偽物に差し替えた1枚のHTMLにする（本番データに触れない）。
- `BACKLOG.md` … 未実装の依頼。新しい依頼は末尾に足し、`main` に入れたら消す。

## ブランチと本番
- `main` に push すると **Netlifyが自動で本番にデプロイ**される。`main` に直接pushしない。自分のブランチで作業し、Pull Requestを出す。マージはオーナー（sho30647）が判断する。
- `firestore.rules` は変更しても自動では反映されない。変えたいときはPRで明示し、オーナーがFirebaseコンソールで公開する。
- 変更が `main` に入る前に、デモ（`python3 tools/build-demo.py out.html`）で触って確認する。

## 権限（コードの外）
- Netlify / Firebaseコンソールは別管理。必要な場合のみオーナーが個別に招待する。共同開発自体には不要（デモはローカルで完結する）。
- 本番のユーザーデータには触れない。テストはFirebaseを差し替えて行う。

## コミット前
- 触った範囲のテストを実行する。エンジンに触れたら `node tests/ring-regression.mjs` と `node tests/engine-nseat.mjs` は必須。
- UIはリング初心者 / リング通常 / MTTで揃える方針。片方だけ変えない。
