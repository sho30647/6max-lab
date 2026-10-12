#!/usr/bin/env bash
# Claude Code の環境「セットアップスクリプト」に貼る（または実行する）。
# 毎回のセッション開始時に、スキルを ~/.claude/skills/ に入れて全リポジトリで使えるようにする。
set -u
DEST="$HOME/.claude/skills"
TMP="$(mktemp -d)"
mkdir -p "$DEST"

clone() { GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 "https://github.com/$1" "$TMP/$2" || echo "skip: $1"; }

clone obra/superpowers superpowers
clone OthmanAdi/planning-with-files pwf
clone anthropics/skills anth
clone lackeyjb/playwright-skill pw
clone yctimlin/mcp_excalidraw exc

cp -r "$TMP"/superpowers/skills/* "$DEST"/ 2>/dev/null
cp -r "$TMP"/pwf/skills/planning-with-files "$DEST"/ 2>/dev/null
cp -r "$TMP"/pw/skills/playwright-skill "$DEST"/ 2>/dev/null
cp -r "$TMP"/exc/skills/excalidraw-skill "$DEST"/ 2>/dev/null
# anthropics/skills は組み込みと重複するもの（docx/pdf/pptx/xlsx/skill-creator/claude-api）を除く
for s in academy-guide algorithmic-art brand-guidelines canvas-design discernment-nudge doc-coauthoring frontend-design internal-comms mcp-builder slack-gif-creator theme-factory web-artifacts-builder webapp-testing; do
  cp -r "$TMP/anth/skills/$s" "$DEST"/ 2>/dev/null
done
rm -rf "$TMP"
echo "global skills installed: $(ls "$DEST" | wc -l)"
