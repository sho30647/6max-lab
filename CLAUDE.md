# 6max-lab

- 未実装の依頼は `BACKLOG.md` にまとめている。ユーザーが「バックログ見せて」と言ったら読んで一覧にする。新しい依頼は末尾に足す。実装して `main` に入れたら、その項目を消す。
- ホスティングはNetlify（`main` へのpushで自動デプロイ）、データはFirebase（Firestore / Google認証）。`firestore.rules` は、変更しても自動では反映されない。ユーザーがFirebaseコンソールで公開する。
