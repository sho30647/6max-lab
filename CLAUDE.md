# 6max-lab

- 共同開発者（オーナー以外）は `docs/CONTRIBUTING.md` を先に読む。`main` に直接pushせず、ブランチ + Pull Requestで出す。

- 未実装の依頼は `BACKLOG.md` にまとめている。ユーザーが「バックログ見せて」と言ったら読んで一覧にする。新しい依頼は末尾に足す。実装して `main` に入れたら、その項目を消す。
- ホスティングはNetlify（`main` へのpushで自動デプロイ）、データはFirebase（Firestore / Google認証）。`firestore.rules` は、変更しても自動では反映されない。ユーザーがFirebaseコンソールで公開する。
- **デモのリンク**：ユーザーが「デモのリンク出して」と言ったら、`python3 tools/build-demo.py <出力.html>` で、いまのブランチの内容を1枚のHTML（Firebaseはログインなしの偽物に差し替え）にして、Artifactで公開してリンクを出す。ログインもクラウド保存も無く、保存はそのブラウザ内だけで、本番のデータには触れない。公開は、次のURLを `url` に指定して**同じURLを更新**する（先に `action: "read"` で読む）：`https://claude.ai/artifact/5fGCgc25UFSzdj2Mjqfug3`。
- **開発の返答にはデモのリンクを付ける**：ユーザーの依頼でブランチに変更をコミットしたら、返答の最後に、上のデモを更新してリンクを出す（ユーザーは `main` に出す前に、それで触って確認する）。コードを変えていない返答（質問への回答など）では更新しない。
- **ブランチと本番反映**：開発は作業ブランチ `claude/wizardly-davinci-svyqce` に積む。`main` へは、ユーザーが「デプロイして」「本番反映」「修正する」と言ったときだけ入れる（勝手に入れない）。手順：①`git fetch origin main` ②`main` に先に入った変更があれば、`origin/main` を作業ブランチにマージして競合を解く ③`tests/` の主要テスト（`ring-regression` `engine-nseat` `mtt-flow` `mtt-live` `mtt-popups` `mtt-resume` `mtt-phone-layout` `mtt-error`）を通す ④作業ブランチを push ⑤`main` を `origin/main` に合わせ、`git merge --ff-only` で作業ブランチを取り込み、`git push origin main`（Netlifyが自動デプロイ）⑥作業ブランチに戻る。作業ブランチは `main` と同じ位置になるが、消さずに次の開発に使う。`firestore.rules` を変えた場合は、反映をユーザーに伝える。
- 画面の挙動を変えたら、`tests/` に確認用のテストを足す（修正前に失敗し、修正後に通ることを確かめる）。
