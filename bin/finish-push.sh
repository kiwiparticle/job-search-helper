#!/usr/bin/env bash
# usage: finish-push.sh <runDir> <artifactsDir> <commitMessage>
# Copies job artifacts into the run, merges, commits and pushes. If main moved meanwhile
# (a page edit, another run), it resets to the new main and redoes the merge on top of it,
# so the run's results are never dropped and nobody's edit is overwritten.
set -uo pipefail
run_dir=$1; a=$2; msg=$3

# Model ids from the run's route: "all" is searchers and reviewers, "searchers" only the first.
# lib/models.js parseRoute is the one validator. No route file means the two original models; a route
# file that does not parse or validate warns on stderr and falls back too. The regex is defence in depth.
route_ids() {
  local f="$a/route/route.json" ids="" id out=""
  if [ -f "$f" ]; then
    ids=$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { parseRoute, reviewersOf } from "./lib/models.js";
      const [f, which] = process.argv.slice(1);
      try {
        const r = parseRoute(readFileSync(f, "utf8"));
        console.log((which === "all" ? [...new Set([...r.searchers, ...reviewersOf(r)])] : r.searchers).join("\n"));
      } catch (e) { console.error(`warning: ${f}: ${e.message}; using claude and codex`); }' "$f" "$1")
  fi
  while IFS= read -r id; do [[ "$id" =~ ^[a-z0-9][a-z0-9-]*$ ]] && out="$out $id"; done <<< "$ids"
  echo "${out:-claude codex}"
}

assemble() {
  mkdir -p "$run_dir/review"
  ids=$(route_ids all)
  [ -f "$a/route/route.json" ] && cp "$a/route/route.json" "$run_dir/"
  [ -f "$a/context/context.json" ] && cp "$a/context/context.json" "$run_dir/"
  [ -f "$a/run-base/base.jsonl" ] && cp "$a/run-base/base.jsonl" "$run_dir/"
  [ -f "$a/company-state/company-state.jsonl" ] && cp "$a/company-state/company-state.jsonl" "$run_dir/"
  for m in $ids; do
    # The model's artifacts are untrusted: only named plain files, size-capped, no links, via this checkout's collector.
    if [ -d "$a/out-$m" ]; then
      /usr/bin/env -i /bin/bash bin/collect-output.sh "$a/out-$m" "$a/col-$m" report.md candidates.json ledger-patch.json ledger-patch.csv coverage.json pending.json status.txt reason.txt || true
      mkdir -p "$run_dir/$m"; cp "$a/col-$m/"* "$run_dir/$m/" 2>/dev/null
    fi
    if [ -d "$a/review-$m" ]; then
      /usr/bin/env -i /bin/bash bin/collect-output.sh "$a/review-$m" "$a/rv-$m" "status-$m.txt" "$m.json" || true
      cp "$a/rv-$m/status-$m.txt" "$a/rv-$m/$m.json" "$run_dir/review/" 2>/dev/null
    fi
  done
  # A search job that never ran its model leaves no status; record it as failed.
  for m in $(route_ids searchers); do
    [ -f "$run_dir/$m/status.txt" ] || { mkdir -p "$run_dir/$m"; echo failed > "$run_dir/$m/status.txt"; echo "its search job never finished (crashed, cancelled or the runner stopped)" > "$run_dir/$m/reason.txt"; }
  done
  node bin/finish.js "$run_dir"
}

# The job token goes on the command line only; the checkout does not persist it.
remote="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git config user.name "job-search bot"
git config user.email "actions@users.noreply.github.com"
for attempt in 1 2 3 4; do
  assemble || exit 1
  git add runs
  git commit -qm "$msg" || exit 0
  git push -q "$remote" HEAD:main && exit 0
  echo "push rejected (attempt $attempt); redoing the merge on the new main"
  git fetch -q "$remote" main || { sleep $((attempt * 5)); continue; }
  git reset -q --hard FETCH_HEAD
  sleep $((attempt * 5))
done
exit 1
