---
name: setup
description: Set up a private copy of the job-search engine, interview the person for their profile and rules, run bin/setup.js and walk them through the dashboard steps.
---

Private repo only: never register a runner on a public repo. If `gh repo view <owner/repo of origin> --json isPrivate -q .isPrivate` is not `true`, stop. Name the repo explicitly: with an `upstream` remote, a bare `gh` command targets the public engine.

Never ask for, read or paste a secret. The person types each one in their own terminal with the `!` prefix.

Follow these steps in order. Say what you are about to do, and do not skip ahead.

1. **Private copy.** If the repo is still the engine clone: `gh repo create <name> --private --source . --remote origin --push` after renaming the old remote with `git remote rename origin upstream` (`upstream` stays so they can pull engine updates). Then pin gh to it: `git config remote.origin.gh-resolved base`. Confirm `git remote -v` shows both and `gh repo view --json nameWithOwner -q .nameWithOwner` prints the private repo.
2. **Interview**, a few questions at a time, then write the files (start from the `examples/` copies; `node bin/setup.js` also copies any missing one):
   - `data/profile.json`: who they are, pay floor and currency, stack, anything the prompts slot in.
   - `data/sweep-filter.json`: title words to require and reject, levels, locations. Bump `version` on later edits.
   - `data/schedule.json`: which searches run and when.
   - `data/models.json`: ask which of `claude`, `codex` they have. Check each with `claude --version` / `codex --version`; set `enabled: false` on any CLI that is not installed and logged in.
   - `instructions.md`: from `examples/instructions.md`, adjusted to their target roles and dealbreakers.
   - `master-resume.md`: from their existing resume (follow `prompts/seed-master.md`), or by interview. Every fact must be true.
3. **Run `node bin/setup.js --check`**, show the result, then `node bin/setup.js`. It checks prerequisites, copies owner files, creates D1 and applies the schema, creates and deploys the Pages project, sets repo variables `JOB_SEARCH_ENABLED`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, and prints the runner commands. Anything it prints as `skip:` is for the person to do by hand (install lines, the runner commands with `sudo`); help them, then re-run until every step is `ok`.
4. **Dashboard steps** (the person clicks; you guide):
   - Cloudflare Zero Trust: Access application for the Pages domain (`<project>.pages.dev`) and any custom domain, one policy allowing only their email. Note the team domain and the application AUD tag.
   - Cloudflare, My Profile, API Tokens: create a token with Account, D1, Edit only, this account only.
   - GitHub, Settings, Developer settings, fine-grained token: only this repo, permissions Actions read/write and Contents read/write (the page dispatches workflows and reads files).
5. **Secrets, typed by the person** (tell them to run each with the `!` prefix so you never see the value; each prompts for it):
   - `! gh secret set CLOUDFLARE_API_TOKEN -R <owner/repo>`
   - `! npx wrangler pages secret put ACCESS_AUD`
   - `! npx wrangler pages secret put ACCESS_TEAM_DOMAIN`
   - `! npx wrangler pages secret put GITHUB_REPO` (`owner/repo`)
   - `! npx wrangler pages secret put GITHUB_TOKEN`
   - `! npx wrangler pages secret put OWNER_EMAIL`
   Then `pnpm run deploy` so the page picks them up.
6. **Optional**, only if they want it: local models (`opencode`, then `node bin/sync-models.js`), `agy` (Gemini), more runners (`~/actions-runner-2` and so on, same private repo).
7. **Verify.** Open the page: it must load only behind Access login. Commit and push the owner files, then `gh workflow run search.yml -R <owner/repo> -f workflow=daily`, watch it with `gh run watch -R <owner/repo>`; leads appear on the New page when it finishes (`tracked` only checks known companies, so it finds nothing on an empty database). If it fails, read the run log with them and fix the cause.
