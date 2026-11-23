#!/usr/bin/env bash
# Build the public engine tree: bin/make-engine.sh <outDir>
# Copies only engine paths (tracked or untracked-not-ignored files) into an empty <outDir>,
# runs the privacy check there, installs and runs the tests. Owner files never go in.
set -euo pipefail

out="${1:?usage: bin/make-engine.sh <outDir>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"

if [ -e "$out" ] && [ -n "$(ls -A "$out")" ]; then
    echo "make-engine: $out is not empty" >&2
    exit 1
fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"

paths=(
    lib bin functions web prompts db test dev .github templates examples .claude/skills/setup
    package.json pnpm-lock.yaml pnpm-workspace.yaml vite.config.ts
    README.md CLAUDE.md LICENSE .gitignore
    docs/model-routing-owner-checklist.md
)

cd "$repo"
git ls-files -z --cached --others --exclude-standard -- "${paths[@]}" \
    | while IFS= read -r -d '' f; do [ -f "$f" ] && printf '%s\0' "$f"; done \
    | xargs -0 cp --parents -t "$out"

echo "make-engine: $(find "$out" -type f | wc -l) files in $out"
node "$repo/bin/privacy-check.js" "$out"

cd "$out"
pnpm install --frozen-lockfile
pnpm test
