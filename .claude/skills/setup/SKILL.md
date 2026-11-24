---
name: setup
description: Set up a private copy of the job-search engine, interview the person for their profile and rules, run bin/setup.js and walk them through the dashboard steps.
---

Two hard rules:

- **Private repo only.** Never register a runner on a public repo. `bin/setup.js` refuses one. If you run `gh` yourself, name the repo with `-R <owner/repo>`: with an `upstream` remote, a bare `gh` command hits the public engine.
- **Never see a secret.** Don't ask for one, read one or paste one. The person types each in their own terminal with the `!` prefix.

Go one step at a time. Say what's next before you do it, and keep your messages short and friendly. Most people doing this aren't developers.

1. **Tools.** Have them run `! bin/install-prereqs.sh`. It skips anything already installed and asks for their password (sudo). Add `--kits` if they want resumes and cover letters, `--browser` for the board finder. Then have them log in to each tool it lists.
2. **Private copy.** If this is still the public engine clone, ask what to call their repo, then run `node bin/setup.js --private-copy <name>`. The engine stays as `upstream` so they can get updates. Check `git remote -v` shows both remotes.
3. **Get to know them.** Ask a few questions at a time, then write the files. Start from the `examples/` copies.
   - `data/profile.json`: who they are, the level and stack they want, location, pay floor and currency.
   - `instructions.md`: from `examples/instructions.md`, changed to fit their target roles and dealbreakers.
   - `master-resume.md`: from their current resume (follow `prompts/seed-master.md`), or by asking. Every fact has to be true.
   - `data/sweep-filter.json`: title words a job must have or can't have, levels, locations.
   - `data/schedule.json`: the default is fine for most people. Ask if they want anything to run more or less often.
   - `data/models.json`: check which of `claude --version` and `codex --version` work. Set `enabled: false` on any that doesn't. Then ask:
     - one searcher (simpler, one runner) or two (more finds, one runner each)?
     - a reviewer: `none` (the default), `null` (two searchers check each other) or a model id?
   - `wrangler.toml`: names for the page and the database (`name`, `database_name`). The default `job-search` is fine unless they already used it on Cloudflare. Setup refuses a taken name.
4. **Run setup.** `node bin/setup.js --check`, show them the result, then `node bin/setup.js`. It builds everything it can. Each `skip:` line is something for them to do. Help with each one, then run it again.
   - The runner step prints a `sudo ./svc.sh` line per runner. They run it with `!`.
5. **Click-through steps.** Step 7 prints the dashboard steps with links already filled in: the Access app, the Cloudflare token and the GitHub token. Walk them through one at a time.
6. **Settings and tokens.**
   - Ask for the email they log in with, the team domain and the AUD tag. None of these is a secret. Run `node bin/setup.js --email <email> --team-domain <team>.cloudflareaccess.com --aud <AUD>`.
   - Step 7 then prints the two token commands. They run each with `!`, and each one asks for the token.
   - Run `node bin/setup.js` again until step 7 says `ok`.
7. **Extras**, only if they ask: local models (`opencode`, then `node bin/sync-models.js`), Gemini (`agy`), more runners.
8. **First search.** Commit and push their files, then run `node bin/setup.js` once more. When every step is `ok`, it starts the first daily search.
   - Have them open the page. It should ask them to log in first.
   - Watch the run with `gh run watch -R <owner/repo>`. Leads show up on New when it finishes.
   - If it fails, read the run log together and fix the cause.
