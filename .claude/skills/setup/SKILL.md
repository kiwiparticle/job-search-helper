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
3. **Get to know them, without making them type.** Their resume already answers most questions, so start there.
   1. **Get their resume.** Ask for the path to the file anywhere on their computer (PDF, Word or text), or have them paste it in. Keep the original out of the repo. Several tailored versions are even better. Convert each to Markdown (`pdftotext`, `pandoc`) into a scratch folder.
   2. **Draft `master-resume.md`** from it, following `prompts/seed-master.md`. Every fact has to be true. Show them the Conflicts list it makes and settle each one.
   3. **Draft the rest from the resume yourself:** what kind of job (engineering, QA / QE / SDET, or both), level, stack, strengths, likely target titles and industries.
   4. **Ask only what a resume can't say**, in one short message:
      - lowest base pay and currency
      - where they want to work (remote, hybrid, which country or city)
      - dealbreakers: work they won't do, industries they avoid, on-call limits
      - anything you guessed and aren't sure of, as a yes/no ("You look like a Senior SDET focused on Playwright. Right?")
   5. **Write the files**, starting from the `examples/` copies, then show a short summary and ask "anything to change?" They can also fix things later in More → Settings on the page.
   - `data/profile.json`: who they are, levels, stack, strengths, work they don't want, location, pay floor and currency, and a fit rubric in their own terms.
   - `instructions.md`: from `examples/instructions.md`, changed to fit their target roles and dealbreakers. For QA, swap the target titles (SDET, QA Engineer, Quality Engineer, Test Automation Engineer) and the tech-fit section (their test frameworks and tools).
   - No resume at all? Ask for their last two or three jobs (title, company, years, what they did), then do the same steps.
   - `data/sweep-filter.json`: title words a job must have or can't have, levels, locations.
     - `roleWords` / `roleNotWords` decide which job titles get saved at all. The example has the engineering lists.
     - For QA / QE / SDET, use `roleWords`: `["qa", "qe", "sdet", "quality", "quality assurance", "test", "tester", "testing", "automation", "engineer in test", "verification"]`, and `roleNotWords`: the example's list without `analyst` (so "QA Analyst" stays).
     - For both, combine the two `roleWords` lists and use the QA `roleNotWords`.
     - Take `QA` and `SDET` out of `titleMustNot` unless they want engineering only.
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
