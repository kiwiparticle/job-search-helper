#!/usr/bin/env bash
# usage: agy-run.sh <repo> <outDir> <prompt> <timeout>
# Runs agy -p with a per-call policy passed as --settings (this session only, never saved), so the owner's
# ~/.gemini/antigravity-cli/settings.json is never touched and any number of agy jobs can run at once.
main() {
repo=$1; out=$2; prompt=$3; limit=$4
policy=$(mktemp) && mark=$(mktemp) || { echo "agy temp file failed"; exit 97; }
# A second INT/TERM (Actions cancel sends INT, then TERM) must not cut cleanup short.
cleanup() { trap '' INT TERM; [ -n "${pid:-}" ] && { kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; }; rm -f "$policy" "$mark"; }
trap cleanup EXIT
trap 'exit 143' INT TERM
node "$repo/bin/agy-policy.js" "$repo" "$out" "$policy" || { echo "agy policy failed"; exit 98; }
cd "$repo" || exit 99
# Background + wait so the trap can run while agy is still going. timeout -k ends a hang (GitHub issue 318) as rc 124.
timeout -k 10s "$limit" agy -p "$prompt" --settings "$policy" </dev/null &
pid=$!
# agy can finish its work and then never exit (no TTY). Once the out dir has files and none changed for AGY_IDLE
# seconds (default 300), stop agy and call it done (rc 0). A run that wrote nothing still ends at the timeout.
# ponytail: any 5 min write gap after the first file counts as done; raise AGY_IDLE if a prompt writes files far apart.
idle=${AGY_IDLE:-300}
while kill -0 "$pid" 2>/dev/null; do
  sleep "${AGY_POLL:-5}"
  last=$(find "$out" -type f -newer "$mark" -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
  if [ -n "$last" ] && [ "$(date +%s)" -gt $(( ${last%.*} + idle )) ]; then
    echo "agy idle ${idle}s after writing output; stopping it (treated as done)"
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=; exit 0
  fi
done
wait "$pid"; rc=$?
pid=
exit "$rc"
}
main "$@"; exit
