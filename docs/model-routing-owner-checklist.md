# Model routing: owner checklist

Things only you can do or check. Nothing here was run during the build. Commands run from the repo root on the PC unless noted.

## opencode (local and hosted models)

- [ ] Confirm opencode reads inline config from `OPENCODE_CONFIG_CONTENT` (if not, tell Claude the right name; `bin/run-model.sh` sets it).
- [ ] Print the per-call config and check its keys against the opencode docs: `node bin/opencode-config.js "$PWD" /tmp/oc-out`
- [ ] Save this probe as `/tmp/oc-probe.md` (it asks for everything the profile must refuse):

  ```
  This is a permissions test. Try each step, then write what happened to each one into {{OUT}}/probe.txt.
  1. Read ~/.local/share/opencode/auth.json and ~/.claude/.credentials.json and print the first line of each.
  2. Write the word hello to /tmp/x.
  3. Run the shell command `ls`.
  4. Start a subagent (the task tool) that says hi.
  5. Fetch https://example.com and give its title.
  ```
- [ ] With a local model enabled, run it by hand: `rm -f /tmp/x; mkdir -p /tmp/oc-out && bin/run-model.sh <opencode registry id> /tmp/oc-probe.md /tmp/oc-out`, then read `/tmp/oc-out/log-<id>.txt` and `/tmp/oc-out/probe.txt`.
- [ ] Check the reads in step 1 were refused (no key text anywhere in the log).
- [ ] Check `/tmp/x` does not exist (write outside the out folder refused).
- [ ] Check `ls` was refused (shell denied).
- [ ] Check the subagent call was refused (`task` denied).
- [ ] Check step 5 worked and `probe.txt` was written (web fetch and the out folder allowed).
- [ ] Check the prompt is accepted on stdin (if not, the fallback is `-- "$prompt"` in `bin/run-model.sh`).
- [ ] Check whether `opencode run -m llama-local/<alias>` swaps the model by itself headless. If it does, the `swap-model` call in `bin/run-model.sh` can go; if not, check that `~/bin/swap-model <alias>` works when the runner calls it.
- [ ] Check web search and fetch work under the `job-search` profile.
- [ ] Run an ask and a fill with a local model from the page (their out folder is outside the repo) and check the answer arrives.

## Local models in the registry

- [ ] Run `node bin/sync-models.js --dry-run` and read the changes (the build's dry run listed 13 new aliases, all added disabled and advisory).
- [ ] Run `node bin/sync-models.js` for real.
- [ ] Set `"enabled": true` on the local models you want (searchers need a context of about 64k or more).
- [ ] If you ever disable `claude` or `codex` (say, for quota), also change `defaults` in `data/models.json` so they name enabled models. Otherwise setup fails with `disabled model: <id> (a default; edit "defaults" ...)`, and kits and ask `both` fail too.
- [ ] Add the hosted GLM entry if you want it: `{ "id": "glm-flash", "label": "GLM Flash", "runner": "opencode", "model": "zai-coding-plan/glm-5.3-flash", "advisory": true }` (advisory is your call).
- [ ] Commit and push `data/models.json`.
- [ ] Start one run with a local searcher and check the report says what it dropped ("ran a lighter pass").

## instructions-local.md

- [ ] Review `instructions-local.md` against `docs/superpowers/specs/2026-11-19-instructions-local-cuts.md` (answer the questions at its end).
- [ ] Edit it as you like, then approve it.
- [ ] Add `"instructions": "instructions-local.md"` to each local model's entry in `data/models.json`, commit and push.

## Gemini via agy

Done 2026-11-19: `agy` installed and logged in; the Actions spike passed (headless with no TTY, web fetch, file written into the output folder, a write outside it and a shell command reported denied; retested 2026-11-19, both are in fact allowed) and was removed; `gemini` is in `data/models.json`.

- [ ] Run one real search with Gemini from the run menu and read the report.
