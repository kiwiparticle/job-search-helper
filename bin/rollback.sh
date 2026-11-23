#!/usr/bin/env bash
# Rollback of the v2 cutover. Prints the steps; runs none of them without --yes.
# Supported for 7 days after cutover. The D1 database is left in place.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Steps:"
echo "  1. export ledger.md from D1 while the v2 code still exists"
echo "  2. git revert the cutover commits (after the tag), then use that export as ledger.md and commit"
echo "  3. move run folders newer than the pre-redesign tag to runs-v2/ and drop them from runs/index.json"
echo "Proposals made after cutover are not restored to asks/."

[ "${1:-}" = "--yes" ] || { echo "Nothing was run. Re-run with --yes to do it."; exit 0; }

git rev-parse -q --verify refs/tags/pre-redesign >/dev/null || { echo "No pre-redesign tag." >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "Working tree is not clean." >&2; exit 1; }

# 1. Export first, while the code that reads D1 still exists (the revert removes it).
tmp=$(mktemp -d)
[ -f ledger.md ] && cp ledger.md "$tmp/ledger.md"
node bin/export-ledger.js --repo "$tmp"
# 2. Revert the cutover commits, newest first, then put the exported table in ledger.md and commit.
for c in $(git rev-list --no-merges pre-redesign..HEAD -- . ':(exclude)runs' ':(exclude)asks' ':(exclude)applications' ':(exclude)data'); do
    git revert --no-commit "$c"
done
cp "$tmp/ledger.md" ledger.md
git add -A
git commit -qm "rollback: revert the v2 cutover, ledger.md exported from D1"
# 3. Run folders made after the tag.
mkdir -p runs-v2
node -e '
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const made = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", "pre-redesign", "HEAD", "--", "runs"], { encoding: "utf8" })
    .split("\n").map((p) => p.match(/^runs\/([^/]+)\/report\.json$/)?.[1]).filter(Boolean);
for (const r of made) fs.renameSync(`runs/${r}`, `runs-v2/${r}`);
const idx = JSON.parse(fs.readFileSync("runs/index.json", "utf8")).filter((x) => !made.includes(x.run));
fs.writeFileSync("runs/index.json", JSON.stringify(idx, null, 2) + "\n");
console.log(`moved ${made.length} run folder(s) to runs-v2/`);
'
git add -A runs runs-v2
git commit -qm "rollback: move v2 run folders to runs-v2" || true
echo "Done. Review with git log, then push."
