#!/usr/bin/env bash
# usage: page-count.sh <resume-draft.md>
# Renders the draft with the resume template, converts it to PDF with LibreOffice, and prints the page count and how full the last page is.
set -euo pipefail
draft=$1; repo=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pandoc "$draft" -f markdown-auto_identifiers --lua-filter "$repo/bin/center-top.lua" --reference-doc "$repo/templates/resume.docx" -o "$tmp/resume.docx"
soffice -env:UserInstallation="file://$tmp/profile" --headless --convert-to pdf --outdir "$tmp" "$tmp/resume.docx" >/dev/null 2>&1
pages=$(pdfinfo "$tmp/resume.pdf" | awk '/^Pages:/ {print $2}')
lines() { pdftotext -f "$1" -l "$1" -layout "$tmp/resume.pdf" - | grep -c '[^[:space:]]' || true; }
full=$(lines 1); last=$(lines "$pages")
# A full page is the most text lines page 1 holds; the last page is measured against it.
echo "pages: $pages"
echo "last page: about $(( last * 100 / (full > 0 ? full : 1) ))% full"
