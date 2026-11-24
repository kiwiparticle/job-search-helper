# job-search-helper

An AI does your job search for you, following rules you write. You get a private web page where you go through what it found, track your applications, ask questions about companies and build resumes and cover letters.

It all runs on your own computer, using the Claude (or Codex) subscription you already have. No API keys, no monthly bill.

**Keep your copy private.** Your computer runs code from the repo, so it has to be a private repo only you control. Setup makes one for you.

## What you need

- Linux or WSL on Windows
- A GitHub account
- A free Cloudflare account
- A Claude or Codex subscription

On Ubuntu or Debian, this installs the rest (Node, pnpm, gh, jq, Claude Code):

```
bin/install-prereqs.sh
```

Add `--kits` if you want resumes and cover letters, and `--browser` for the board finder. Both are optional.

## Set up

```
git clone https://github.com/kiwiparticle/job-search-helper
cd job-search-helper
claude
```

Then type `/setup`. Claude walks you through all of it:

1. Makes your private copy of the repo
2. Asks about you: the roles you want, your pay floor, your resume
3. Creates the database and the web page on Cloudflare
4. Sets up the runner, the program that does the searches on your computer
5. Gives you links for the few things you click yourself on GitHub and Cloudflare
6. Starts your first search

You paste the two access tokens yourself, so Claude never sees them. Until setup is done, the page tells you what's still missing.

**No Claude Code?** Run `node bin/setup.js --private-copy <repo name>`, fill in the files it copies from `examples/`, then keep running `node bin/setup.js` until every step says `ok`. Add `--check` to see what it would do without changing anything.

## Getting updates

```
pnpm ship
```

That pulls the latest version, runs the tests, pushes and redeploys your page. Your own files are never touched.

## What it costs

Nothing extra. A private GitHub repo, a runner on your own computer and Cloudflare's free plan are all free. The searches use your existing subscription.

## Your files

These are yours to edit. Updates never change them.

- `instructions.md`: the rules every search follows
- `master-resume.md`: every true fact about you. Resumes and cover letters only use what's in here.
- `data/profile.json`: who the search is for: level, stack, location, pay floor
- `data/schedule.json`: which searches run on their own, and when (times are UTC)
- `data/sweep-filter.json`: title words a job must have or can't have. Bump `version` after you edit it so old roles get checked again.
- `data/reasons.json`: the quick reasons Skip and Save offer
- `data/models.json`: which AI models you use

Everything else (companies, jobs, applications) lives in the database. Change it on the page. Don't edit `data/*.jsonl`: it's a backup that gets rewritten every day.

## What runs

Out of the box, three things run on their own:

- **Daily search** (Mon, Wed, Fri): looks for new jobs
- **Tracked search** (every day): re-checks companies you're following and their job boards
- **Board sweep** (twice a day): grabs new roles straight from companies' job boards. No AI, just a script.

Add more to `data/schedule.json`, or start any of these from the page's Searches menu:

- **Culture search**: finds companies by how they work
- **Vertical search**: digs deep into one industry
- **Posting check**: spots jobs that were taken down, and saves the daily backup
- **Tune**: reads your Skip and Save reasons and suggests changes to your rules. Nothing changes until you click Apply.

From any company or job on the page you can also:

- **Ask** a question about a company
- **Fill** in missing facts about it
- **Kit**: write a resume, cover letter or form answers for one job

Nothing runs while your computer is off. Jobs wait until it's back on.

## What a search can and can't change

- It never changes a stance you set yourself.
- It never rules out a company on its own. It suggests it, and you decide under Passed → Companies.
- It never touches a company you've ruled out or one you've applied to.
- If you changed something while it was running, your change wins.
- Undo on a run's page reverts what that run changed.

## Models

- **Per run:** pick the searchers and reviewer in the run menu.
- **Defaults:** edit `defaults` in `data/models.json`, then commit and push.
- **Turn one on or off:** More → Models on the page.
- **Local models:** add them to your `model-configs.json`, then run `node bin/sync-models.js`. They show up turned off. Turn on the ones you want.
- **Gemini:** install the Antigravity CLI and run `agy` once to log in.

If Claude or Codex gets logged out, the run shows as failed on the Status page and says why. Log back in (`claude`, or `codex login`) and run it again.

## Backups

- **The last 7 days:** Cloudflare can roll the whole database back to any minute. Go to D1 → your database → Time Travel.
- **Older than that:** a copy is saved to `data/*.jsonl` in your repo twice a day, and git keeps every old version. There's no script to load it back into the database yet.

## For developers

```
pnpm test          # all tests
npx tsc -p web     # type check the page
pnpm run preview   # the page on localhost:8099 with your local data
```

- `pnpm run deploy` publishes the page.
- If an update adds a database table, run this before deploying: `npx wrangler d1 execute <database name> --remote --file db/schema.sql`. It only adds what's missing.
- `CLAUDE.md` explains how the pieces fit together.
