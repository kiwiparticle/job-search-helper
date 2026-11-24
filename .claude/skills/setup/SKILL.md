---
name: setup
description: Set up a private copy of the job-search engine, interview the person for their profile and rules, run bin/setup.js and walk them through the dashboard steps.
---

Private repo only: never register a runner on a public repo. If `gh repo view <owner/repo of origin> --json isPrivate -q .isPrivate` is not `true`, stop. Name the repo explicitly: with an `upstream` remote, a bare `gh` command targets the public engine.

Never ask for, read or paste a secret. The person types each one in their own terminal with the `!` prefix.

Follow these steps in order. Say what you are about to do, and do not skip ahead.

1. **Private copy.** If the repo is still the engine clone, ask for a repo name and run `node bin/setup.js --private-copy <name>`: it renames `origin` to `upstream` (so they can pull engine updates), creates the private repo as `origin` and pushes. Confirm `git remote -v` shows both.
2. **Interview**, a few questions at a time, then write the files (start from the `examples/` copies; `node bin/setup.js` also copies any missing one):
   - `data/profile.json`: who they are, pay floor and currency, stack, anything the prompts slot in.
   - `data/sweep-filter.json`: title words to require and reject, levels, locations. Bump `version` on later edits.
   - `data/schedule.json`: which searches run and when.
   - `data/models.json`: ask which of `claude`, `codex` they have. Check each with `claude --version` / `codex --version`; set `enabled: false` on any CLI that is not installed and logged in. Then ask how searches use them and write `defaults.search`:
     - one searcher (cheaper, one runner) or two (more finds; each needs its own runner to run side by side);
     - reviewer: `none` (the default), `null` for "each other" (two searchers check each other's finds), or a model id.
   - `wrangler.toml` (copy `examples/wrangler.toml`): a name for the Pages project and the D1 database, `name` and `database_name`. The default `job-search` is fine for a first install; it must be unused on their Cloudflare account (`bin/setup.js` refuses a taken one). The page lives at `<name>.pages.dev`.
   - `instructions.md`: from `examples/instructions.md`, adjusted to their target roles and dealbreakers.
   - `master-resume.md`: from their existing resume (follow `prompts/seed-master.md`), or by interview. Every fact must be true.
3. **Prerequisites.** If step 1 of `node bin/setup.js --check` lists missing tools, have the person run `! bin/install-prereqs.sh` (it uses sudo; add `--kits` if they want application kits, `--browser` for the board finder), then the logins it prints.
4. **Run `node bin/setup.js --check`**, show the result, then `node bin/setup.js`. It checks prerequisites, copies owner files, creates D1 and applies the schema, creates and deploys the Pages project, sets repo variables `JOB_SEARCH_ENABLED`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, downloads and registers one runner per searcher (`~/actions-runner-<repo>`, `-2`), then prints the `sudo ./svc.sh` line that starts each. Anything it prints as `skip:` is for the person to do by hand (install lines, the `sudo` lines); help them, then re-run until every step is `ok`. Step 7 stays `skip:` until steps 5 and 6 below are done.
5. **Dashboard steps** (the person clicks; you guide): step 7 of `node bin/setup.js` prints them with this repo's links and pre-filled token pages (Access app, Cloudflare D1 token, GitHub token). Walk the person through them one at a time.
6. **Page settings and tokens.**
   - Ask for their Access email, the team domain and the AUD tag (none is a secret), then run `node bin/setup.js --email <email> --team-domain <team>.cloudflareaccess.com --aud <AUD>`. It sets those and `GITHUB_REPO` on the Pages project and deploys.
   - The two tokens are secrets, typed by the person: step 7 prints the two commands (`gh secret set CLOUDFLARE_API_TOKEN ...`, `npx wrangler pages secret put GITHUB_TOKEN ...`). Tell them to run each with the `!` prefix so you never see the value; each prompts for it.
   - Re-run `node bin/setup.js` until step 7 is `ok`. Then `pnpm run deploy` if it did not just deploy.
7. **Optional**, only if they want it: local models (`opencode`, then `node bin/sync-models.js`), `agy` (Gemini), more runners than one per searcher (only useful when local models or kits run alongside searches).
8. **Verify.** Open the page: it must load only behind Access login. Commit and push the owner files, then re-run `node bin/setup.js`: once every step is `ok`, step 8 starts the first daily search. Watch it with `gh run watch -R <owner/repo>`; leads appear on the New page when it finishes (`tracked` only checks known companies, so it finds nothing on an empty database). If it fails, read the run log with them and fix the cause.
