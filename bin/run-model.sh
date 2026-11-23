#!/usr/bin/env bash
# usage: run-model.sh <registry id> <promptFile> <outDir> [statusFile]
# Always exits 0; the outcome goes to statusFile (ok | failed | auth) so the run can continue on one model.
set -uo pipefail
# The whole body is a function so bash has parsed all of it before the model starts: a model that edits this file
# in place cannot make bash run new bytes when the model returns.
main() {
model=$1; prompt_file=$2; out=$3; status=${4:-$out/status.txt}
# Why a run failed, in plain words, beside status.txt (the search finish shows it on the report and Status).
reason=$(dirname "$status")/reason.txt
rm -f "$reason"
repo=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
log="$out/log-$model.txt"
info=$(node "$repo/bin/model-info.js" "$model") || { echo "unknown or disabled model $model" >&2; echo failed >"$status"; exit 0; }
IFS=$'\t' read -r runner mname ctx instr <<<"$info"
# model-info writes - for an empty field: a tab is IFS whitespace and would collapse empty fields.
[ "$mname" = - ] && mname=; [ "$ctx" = - ] && ctx=; [ "$instr" = - ] && instr=
# A trimmed context-<model>.json (written by route.js for a local model) wins over the shared context.json.
CONTEXT_FILE=${CONTEXT_FILE:-}
if [ -z "$CONTEXT_FILE" ] && [ -n "${RUN_DIR:-}" ]; then
  CONTEXT_FILE=$RUN_DIR/context.json
  [ -f "$RUN_DIR/context-$model.json" ] && CONTEXT_FILE=$RUN_DIR/context-$model.json
fi
export CONTEXT_FILE
export INSTRUCTIONS_FILE=${INSTRUCTIONS_FILE:-${instr:-instructions.md}}
# Fill {{NAME}} slots (env, then data/profile.json) first: the budget check measures the filled prompt.
if ! OUT="$out" MODEL="$model" REPO="$repo" node "$repo/bin/fill-prompt.js" "$prompt_file" >"$out/prompt.txt" 2>"$out/fill-error.txt"; then
  echo "$model refused: $(cat "$out/fill-error.txt")" >&2; echo failed >"$status"; echo "refused before starting: $(head -c 300 "$out/fill-error.txt")" >"$reason"; exit 0
fi
if [ -n "$ctx" ]; then
  case $INSTRUCTIONS_FILE in /*) inst_path=$INSTRUCTIONS_FILE ;; *) inst_path=$repo/$INSTRUCTIONS_FILE ;; esac
  check_files=("$out/prompt.txt" "$inst_path")
  [ -n "$CONTEXT_FILE" ] && [ -f "$CONTEXT_FILE" ] && check_files+=("$CONTEXT_FILE")
  node "$repo/bin/model-info.js" "$model" --check "${check_files[@]}" 2>"$out/refused.txt"
  # Fail closed: any nonzero exit (over budget, or a crash such as a missing file) refuses the launch.
  if [ $? -ne 0 ]; then echo "$model refused: $(cat "$out/refused.txt")" >&2; echo failed >"$status"; echo "refused before starting: $(head -c 300 "$out/refused.txt")" >"$reason"; exit 0; fi
  rm -f "$out/refused.txt"
fi
prompt=$(cat "$out/prompt.txt")

case $runner in
  claude)
    # Prompt goes on stdin: --add-dir is variadic and swallows a trailing prompt argument.
    # Runs from the repo so Claude picks up this repo's context, not the caller's. A registry `model` (sonnet, opus) picks the model.
    # NO_WEB=1 (re-check, follow-up): no web tools at all, so a run that should read only its files can't fetch a page.
    web="WebSearch,WebFetch,"; [ "${NO_WEB:-}" = 1 ] && web=""
    printf '%s' "$prompt" | (cd "$repo" && timeout 50m claude -p ${mname:+--model "$mname"} \
      --allowedTools "${web}Read,Write,Edit,Bash(grep:*),Bash(ls:*),Bash($repo/bin/page-count.sh:*)" \
      ${NO_WEB:+--disallowedTools "WebSearch,WebFetch"} \
      --add-dir "$out") >"$log" 2>&1
    rc=$? ;;
  codex)
    # --search is a top-level flag; it must come before `exec`.
    # ponytail: NO_WEB covers claude and codex only; opencode and agy keep their web tools (local re-check is rare).
    search=--search; [ "${NO_WEB:-}" = 1 ] && search=
    timeout 50m codex $search exec -s workspace-write -C "$repo" --add-dir "$out" --skip-git-repo-check "$prompt" >"$log" 2>&1
    rc=$? ;;
  opencode)
    # Permissions are built per call with the real $out (UNVERIFIED env var name and syntax; see lib/opencodeConfig.js).
    OPENCODE_CONFIG_CONTENT=$(node "$repo/bin/opencode-config.js" "$repo" "$out") || { echo "opencode config failed" >&2; echo failed >"$status"; exit 0; }
    export OPENCODE_CONFIG_CONTENT
    if [[ $mname == llama-local/* ]]; then
      # One GPU: queue behind the lock (outside the timeout so waiting costs no run time), swap the model in, run.
      # ponytail: swap-model is called because whether the plugin swaps headless is unverified; drop it if it does.
      # The swap has its own timeout (SWAP_TIMEOUT seconds, 600 by default) so a hung swap cannot eat the job's time.
      printf '%s' "$prompt" | flock -w 3300 /tmp/job-search-gpu.lock bash -c '
        timeout -k 10s "$5" "$1" "$2" </dev/null || { echo "swap failed for $2 (rc $?)"; exit 97; }
        exec timeout 50m opencode run -m "$3" --agent job-search --dir "$4"' _ \
        "${SWAP_MODEL_BIN:-$HOME/bin/swap-model}" "${mname#llama-local/}" "$mname" "$repo" "${SWAP_TIMEOUT:-600}" >"$log" 2>&1
    else
      printf '%s' "$prompt" | timeout 50m opencode run -m "$mname" --agent job-search --dir "$repo" >"$log" 2>&1
    fi
    rc=$? ;;
  agy)
    # Gemini via the Antigravity CLI. Login only (cached by an interactive `agy` once); never an API key.
    # The CLI documents -p "<prompt>" and no stdin prompt in text mode, so stdin is /dev/null: GitHub issue 318 reports
    # `agy -p` hanging without a TTY, and timeout -k turns a hang into rc 124 -> failed. AGY_TIMEOUT is for tests only.
    # The policy goes in per call with --settings (agy-run.sh), so agy jobs run in parallel with no lock.
    # No --dangerously-skip-permissions. Unlisted writes and shell commands are NOT denied (tested 2026-11-19).
    # To enable after the owner's spike passes, add to data/models.json:
    #   { "id": "gemini", "label": "Gemini", "runner": "agy" }
    "$repo/bin/agy-run.sh" "$repo" "$out" "$prompt" "${AGY_TIMEOUT:-50m}" >"$log" 2>&1
    rc=$? ;;
  *) echo "unsupported runner $runner for $model" >&2; echo failed >"$status"; echo "unsupported runner $runner" >"$reason"; exit 0 ;;
esac

# agy's own unauthenticated error; added for agy only so the other runners' mapping is unchanged.
auth_extra=; [ "$runner" = agy ] && auth_extra='|authentication required'
if [ $rc -eq 0 ]; then
  echo ok >"$status"
elif tail -n 15 "$log" | grep -qiE "hit your .*limit|usage limit|rate limit (reached|exceeded)|quota (exceeded|reached)"; then
  echo limit >"$status"
# Only the CLI's own last words: the transcript is full of postings that say "401(k)".
elif tail -n 15 "$log" | grep -qiE "(401|403) unauthori[sz]ed|\bunauthori[sz]ed\b|not logged in|please (re-)?log ?in|log ?in again|refresh token|token (has )?expired|invalid (api key|token)|authentication (failed|error)$auth_extra"; then
  echo auth >"$status"
else
  echo failed >"$status"
  case $rc in
    124|137) echo "timed out (50 min limit)" >"$reason" ;;
    97) echo "the GPU model swap failed" >"$reason" ;;
    *) echo "the CLI exited with code $rc" >"$reason" ;;
  esac
fi
case $(cat "$status") in
  limit) echo "hit its usage limit" >"$reason" ;;
  auth) echo "not logged in: run the CLI by hand to log in again" >"$reason" ;;
esac
# opencode's words when a permission rule stops a write: the run "finishes" with nothing saved.
grep -q "prevents you from using this specific tool call" "$log" 2>/dev/null && [ ! -f "$out/candidates.json" ] && echo "file writes were blocked by its permissions, so it saved nothing" >"$reason"
echo "$model rc=$rc status=$(cat "$status")"
exit 0
}
main "$@"; exit
