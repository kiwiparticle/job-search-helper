# job-search-helper

A model (Claude by default; Codex, local models and Gemini are options) runs your job search from rules you write, and saves the results in Cloudflare D1. A private page on your own domain shows them: you triage leads, track applications, ask questions about companies and build resume and cover-letter kits. Everything runs on your own machine through your own subscriptions.

**Safety first: use a private copy.** The runner executes workflow code on your machine. Never register a self-hosted runner on a public repo. Make a private copy of this engine and run everything from that.

## Prerequisites

Linux or WSL only. You need:

- Node 26 or newer and `pnpm`
- `git` and the GitHub CLI `gh`, logged in
- A Cloudflare account (free plan) and `wrangler` logged in
- Claude Code, and at least one model CLI logged in (`claude` or `codex`)

## Set up

```
git clone https://github.com/kiwiparticle/job-search-helper
cd job-search-helper
claude
```

Then run `/setup` in Claude Code. It makes your private copy (keeping this repo as the `upstream` remote), interviews you for your profile and rules, creates the D1 database and Pages project, sets the repo variables, and walks you through the dashboard steps (Access, tokens). It downloads and registers the runner and sets the page's Access settings; you type the two tokens yourself and Claude never sees them. Until setup is done the page says which settings are missing. `node bin/setup.js --check` is a dry run that changes nothing.

Setup sets the repo variable `JOB_SEARCH_ENABLED` in step 5, before the runner and secrets exist; nothing runs without it. Runs start once the runner and secrets are in place.

## Updating

Engine changes arrive from upstream:

```
git pull --no-rebase upstream main
```

Your own files (`instructions.md`, `master-resume.md`, `data/profile.json`, `data/schedule.json`, `data/sweep-filter.json`, `data/models.json`, `wrangler.toml` and so on) are yours; `examples/` holds the neutral starting copies. Then `pnpm test` and `pnpm run deploy`.

## Costs

- GitHub private repo and self-hosted runner: free.
- Cloudflare free plan: Pages, D1 and Access (up to 50 users).
- Models run through the CLIs on your own subscriptions or GPU. No paid API keys are used or needed.

## Files you edit

- `instructions.md`: the rules every search follows.
- `master-resume.md`: every true fact about you. Application kits may only use what is here.
- `data/profile.json`: who the search is for (level, stack, location, pay floor).
- `data/schedule.json`: which runs start on their own and when (UTC).
- `data/sweep-filter.json`: words a swept role's title must or must not have, levels and locations. Bump `version` after an edit so filtered roles are checked again.
- `data/reasons.json`: the one-tap reasons Skip and Save offer. They feed the weekly tune run, which suggests edits to `instructions.md` and the sweep filter. Nothing changes until you click Apply.
- `data/models.json`: model registry and defaults.
- `history.md`: dated history, an archive.

Your data (companies, postings, applications) lives in D1, and you change it on the page. Don't edit `data/*.jsonl` by hand: it is the daily export.

## What runs

In a new copy `tracked` search, `daily` search (Mon, Wed, Fri) and `sweep` run on their own. The other workflows run when you add them to `data/schedule.json` (times are UTC) or start them by hand from the page; the table's times are suggestions. Everything runs on a self-hosted GitHub Actions runner on your machine, using your own Claude and Codex logins. Nothing runs while the machine is off. Queued jobs wait for it.

| Workflow | Suggested schedule (set in `data/schedule.json`) | Does |
| --- | --- | --- |
| `search` (`daily`) | Mon, Wed, Fri 11:00 UTC, or by hand | Fresh role discovery |
| `search` (`tracked`) | Daily 10:00 UTC, or by hand | Daily active-lead and weekly application/watched-company monitoring; up to 15 manual boards and 30 role screens per run |
| `search` (`links`) | By hand | Finds careers and jobs links for up to 40 tracked companies that have none |
| `search` (`culture`) | Mon 13:00 UTC, or by hand | Culture-first company discovery |
| `search` (`vertical`) | Tue, Thu 11:00 UTC (the queued verticals), or by hand (pick verticals in the run menu) | Deep vertical sweep |
| `search` (`reconcile`) | Fri 13:00 UTC, or by hand | Checks company records against history |
| `sweep` | 04:00 and 16:00 UTC, or by hand (run menu: Sweep job boards) | Script, no model: saves new senior roles from tracked companies' own boards. They show in New as "Found on boards, not reviewed" |
| `check-postings` | 06:00 and 18:00 UTC, or by hand (the page's Re-check buttons) | Checks saved jobs, applications and new leads; prunes when run on the 1st; exports `data/*.jsonl` and commits it |
| `resolve-links` | Sun 07:00 UTC, or by hand (run menu) | Script, no model: finds the Greenhouse, Lever or Ashby board behind a careers page and sets it as the jobs link |
| `tune` | Sat 13:00 UTC, or by hand (Searches) | Reads your Skip and Save reasons since the last tune and proposes rule edits; skips the model when there are none |
| `ask` | From the page | One question about one company, to Claude, Codex or both |
| `fill` | From the page | Looks up facts for one company |
| `kit` | From the page | Resume, cover letter or form answers for one job |

A search run works like this:
1. The searcher (or two, if you pick them) searches on its own.
2. A reviewer, if you pick one, checks the finds. Its opinion shows on the lead and changes nothing.
3. The script merges the results and writes them to D1:
   - per field, the first searcher's value wins; every model's opinion stays visible on the lead
   - a stance you set is never changed by a run; models only change empty stances or ones a model set
   - a model never rules a company out on its own: it suggests it, and you confirm or keep the company under Passed → Companies
   - a field that changed since the run started is left alone
   - nothing changes a company you've ruled out or one with an open application
   - Undo on the run page reverts a run's change to a company

Run output goes in `runs/<date>-<workflow>/`.

## The runner

`node bin/setup.js` downloads and registers a GitHub Actions runner per searcher and prints the `sudo` line that starts each as a service. If Claude or Codex logs out, the page shows a banner: run `claude` or `codex login`, then start the run again.

## Models

Which models a run uses comes from `data/models.json`.

- **Pick per run:** in the run menu, set First searcher, Second searcher and Reviewer. A greyed-out model has too small a context for that job.
- **Change the defaults:** edit `defaults` in `data/models.json`, commit and push.
- **Local model:** add the alias to your `model-configs.json`, then `node bin/sync-models.js --dry-run` and `node bin/sync-models.js`. New models arrive disabled; set `"enabled": true` on the ones you want.
- **Gemini (`agy`):** install the Antigravity CLI and run `agy` once to log in.

What to check by hand for local models and agy is in `docs/model-routing-owner-checklist.md`.

## Cloudflare

`pnpm run deploy` deploys to the Pages project named by `name` in `wrangler.toml`. Schema: `db/schema.sql`. After a schema change that adds a table, apply it before deploying: `npx wrangler d1 execute <your database name> --remote --file db/schema.sql` (it only creates what is missing).

`pnpm run preview` serves the built page on localhost:8099 with the repo's `data/*.jsonl` in a throwaway database. `PREVIEW_DATA=<path> pnpm run preview` reads data and owner files from another checkout instead.

Only the search setup and finish jobs, the ask, fill and similar prepare and finish jobs, the check-postings job and the resolve-links job get the Cloudflare token. Jobs that run a model never do.

## Backups and restore

- **Export.** `check-postings` writes `data/companies.jsonl`, `data/postings.jsonl` and `data/history.jsonl` to the repo each time it runs, one record per line. The check is scheduled twice daily; the backup is only as fresh as the last successful run, including when the machine is off. Git history of `data/` holds the earlier copies. To see an older state: `git log --oneline -- data/` and `git show <commit>:data/companies.jsonl`.
- **Restoring from the export is manual.** No script loads `data/*.jsonl` back into D1 yet. Ask for one to be written before you need it.
- **D1 Time Travel** restores the whole database to any minute in the last 7 days (free plan). Dashboard: D1 → `job-search` → Time Travel. Or from a terminal: `npx wrangler d1 time-travel restore --help`, then restore to the time you want. Anything written after that time is lost.

## Tests

```
pnpm test          # node --test (pipeline, D1 store, backend) and Vitest (page)
npx tsc -p web     # typecheck the page
```

No dependencies for the pipeline and backend. Node 26 or newer.

## Search coverage and retries

Tracked monitoring runs on its `data/schedule.json` schedule (daily by default). It checks active leads daily and active applications and other tracked companies every seven UTC calendar days. Ruled-out companies are excluded first. Active applications retain their protected facts, stance and outcomes.

Successful supported-board API reads count as script verification. Manual board checks are only model-reported evidence. API-capable boards cannot be kept fresh by model claims. Blocked and unfinished checks remain due. Posting-liveness checks still run separately twice daily.

Manual checks share 15 slots: five each for active leads, applications, and other tracked companies; unused slots are borrowed in that order. Overflow and incomplete checks appear in the run report. Daily/weekly coverage can fall behind when targets exceed capacity.

Role screening uses up to 30 slots, one per company per round, ordered by the company's last scheduling attempt. Within a company, never-tried roles come first. Every discovered board role stays queued until explicitly judged or skipped; omission never means pass. Model reports may include up to 200 additional unreviewed discoveries from manual boards, with larger overflow labeled partial.

Setup remains read-only. Attempt and evidence timestamps are saved atomically by finish, even after failed model jobs. A failed finish leaves no durable attempt until retried. A completed rerun never repeats attempts or patches. Sendbacks require an existing completion marker and apply no company patches.

Normal search and review jobs read the same fresh D1 snapshot, `company-state.jsonl`; original patch protection uses a separate `base.jsonl`. Sendbacks get a fresh company snapshot without replacing the original base. Retrying a workflow reuses its frozen preparation artifacts and execution identity; expired artifacts require a fresh run.
