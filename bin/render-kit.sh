#!/usr/bin/env bash
# usage: render-kit.sh <kitDir>  — renders the newest round of each piece to .docx with the resume template's styles.
set -euo pipefail
kit=$1; repo=$(cd "$(dirname "$0")/.." && pwd)
latest() { ls "$kit"/$1-[0-9].md 2>/dev/null | sort | tail -1 || true; }
r=$(latest draft); [ -n "$r" ] && pandoc "$r" -f markdown-auto_identifiers --lua-filter "$repo/bin/center-top.lua" --reference-doc "$repo/templates/resume.docx" -o "$kit/resume.docx"
c=$(latest cover-letter); [ -n "$c" ] && pandoc "$c" -f markdown-auto_identifiers --reference-doc "$repo/templates/cover-letter.docx" -o "$kit/cover-letter.docx"
a=$(latest answers); [ -n "$a" ] && cp "$a" "$kit/answers.md"
ls "$kit"
