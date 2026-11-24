# CLAUDE.md

How this repo fits together and what has bitten before. `README.md` has setup and operations steps. Design notes are in `docs/superpowers/specs/` (data rules: `2026-11-16-redesign-v2-design.md`). "The owner" means whoever runs their copy of this engine.

## What this is

A private job-search tool for one person (the owner), run from a private copy of the public engine. A model (Claude by default; any model in `data/models.json`) searches for remote senior engineering roles from `instructions.md` and updates the data in Cloudflare D1. A private page on the owner's Cloudflare Pages domain shows the results, starts runs, changes stances and job states, builds application kits and answers questions about companies. The goal is more applications per week: finding is solved, triage is the work.

- **Subscriptions only.** Models run through the `claude`, `codex`, `opencode` (local llama) and `agy` (Gemini) CLIs on the owner's logins or GPU. Never add paid API keys.
- **One user.** Cloudflare Access allows only the owner's email, pages included.
- **Settled, don't relitigate:** self-hosted runner on the owner's machine; D1 for data; git for run reports, ask threads, kits, follow-up drafts (`followups/`), owner files and a daily export; React + Vite + TanStack Query + React Router (the owner is learning React).
- **Free Cloudflare plan** (10 ms CPU per request): page writes are versioned D1 row writes, never file edits.
- **Hosting:** a Cloudflare Pages project (direct upload; its name is `name` in `wrangler.toml`) on its `pages.dev` domain and any custom domain, one Access app for all.

## Working here

- Run commands from the repo root.
- Code changes are made in the engine checkout; owner repos pull them with `git pull --no-rebase upstream main`.
- Ship loop: change, `pnpm test`, `npx tsc -p web`, check UI in a real browser with a screenshot, commit, `git pull --rebase`, push, `pnpm run deploy`, say what to reload.
- After a local `git merge`, don't `git pull --rebase` (it flattens the merge). `git fetch`, then `git push`; if the remote moved, `git pull --no-rebase --no-edit`, then push.
- A fresh worktree needs `pnpm install --frozen-lockfile`.
- Another session may be committing to `main`. For multi-file work: `git worktree add .claude/worktrees/<name> -b <name> origin/main`, `pnpm install --frozen-lockfile`, then `git fetch && git rebase origin/main` and `git push origin HEAD:main` per slice.
- Uncommitted files you didn't make in the main checkout belong to another session: `git add` only your paths, `git fetch` and push if not behind; never stash or commit them.
- Small, clear changes: just do them, no spec. Specs only for data-model changes. Design questions: recommend, list options with cost, wait.
- Commits go straight to `main` (the runner and page commit there too). End commits with the harness's `Co-Authored-By` and `Claude-Session` trailers.

## Owner files

Code never edits these unless the entry names its exception. Model runs only return patches or reports.

- `instructions.md`: the rules every search follows (~500 lines, read in full each run). `instructions-local.md` is a condensed copy for local models (registry `"instructions"` field). Exception (both, and `data/sweep-filter.json`): `tune-apply.yml` makes one find/replace from a tune proposal the owner applied.
- `master-resume.md`: every true fact about the owner. Exception: `merge-master.yml` adds one bullet under a heading listed in `data/master-sections.json` when the owner clicks Add to master.
- `examples/`: neutral starting copies of every owner file below; `bin/setup.js` copies any that is missing.
- **Settings page exception:** `#/settings` (`setSettings`, `lib/settings.js`) rewrites `data/reasons.json`, `data/sweep-filter.json` (bumping `version`) and `data/profile.json`, one commit per tab save; only the keys its tab owns, refused (409) when the file moved since the page read it.
- `data/profile.json`: who the search is for (`who`, `levels`, `stack`, `location`, `strengths`, `offStack`, `domainsFirst`, `fitRubric`, `tieBreak` (optional; default ties pay to the floor), `payFloor`, `currency`). `bin/fill-prompt.js` fills it into prompts as `{{PROFILE_*}}`; a missing file refuses the model run.
- `data/models.json`: model registry and defaults. Exceptions: `bin/sync-models.js` (by hand) adds and updates `llama-local/` entries; the page's Models dialog (More ▾, `setModels`) flips `enabled` with one commit. Both write through `lib/modelsText.js` to keep the layout.
- `data/sweep-filter.json`: board-sweep filter (`version`, `roleWords`/`roleNotWords` (which titles the sweep stores at all; absent means the engineering defaults in `lib/sweepFilter.js`), `titleMust`, `titleMustNot`, `titleDrop` (words that drop a role before it is stored; absent means intern, junior, apprentice, co-op), `titleNonSoftware` (rejects only titles with no `softwareWords` word), `softwareWords`, `levels`, `locations`). Bump `version` after an edit so filtered roles are re-checked.
- `wrangler.toml`: Pages project `name` and the D1 binding and id.
- `CLAUDE.local.md`: the owner's own notes, loaded beside this file; exists only in the owner's repo.
- `data/schedule.json`: which runs start on their own and when (UTC), read by `schedule.yml` and the page.
- `data/reasons.json`: the one-tap reasons Skip, Save and Rule out offer (`{ skip: [], save: [], ruleOut: [] }`).
- `data/sources.json` (culture run sources), `data/verticals.json` (vertical sweep list), `data/master-sections.json`.
- `docs/resume-cover-letter-guidelines.md`, `docs/positioning.md`: read by kit prompts.
- `history.md`: dated archive. Grep by company name, never read whole.
- `data/*.jsonl` is the generated daily export of D1. Don't hand-edit it.

## Data (Cloudflare D1)

Database `job-search`, bound as `DB`. Schema `db/schema.sql`. Each row is one record as JSON text with a `version`.

| Table | Holds | Written by |
| --- | --- | --- |
| `companies` | identity, stance (`stanceBy` when a model set it), facts, `rolesSkipped`, job states (`jobs`), applications, `proposals`, `events` | page actions, search/ask/fill finish |
| `postings` | slim postings: role, url, `modelSays`, `payEstimate`, `wasLead`, `posted`, `goneAt`, `source`, `location`, `filteredBy` | search finish, sweep, posting check (also prunes) |
| `supplement` | owner facts outside the master (`open`, `merging`, `merged`, `dismissed`) | page supplement actions, `bin/merge-master.js` |
| `tune` | tune-run proposals: one find/replace in an allowed file with its `baseSha` (`open`, `applying`, `applied`, `dismissed`, `stale`) | tune finish, page `applyTune`/`dismissTune`, `bin/tune-apply.js` |
| `history` | history excerpts from the v1 migration (nothing writes it now) | none |
| `finished_runs` | one row per finished run/ask/fill, with the change list Undo needs | the same finish batch |

- **Versioned writes.** Every UPDATE/DELETE names the version it read and is followed by `INSERT INTO guard (ok) SELECT 0 WHERE changes() = 0`. A moved version fails the CHECK and aborts the whole batch. `lib/store.js` `writeRows` turns that into `409 stale write`. Only write D1 through `writeRows`.
- **Delta reads.** Each `writeRows` batch that writes companies or postings bumps `meta.seq` once, stamps those rows' `seq` and records deletes in `deleted`. `/api/companies` and `/api/postings` send `x-seq` with a full load; `?since=<seq>` returns only rows and deleted ids after it (`deltaJson`, over 700 rows says `full`). The page keeps the seq in its cache. A write that skips `writeRows` is never seen by an open page.
- **Page writes:** read the rows, run a pure function from `lib/ownerActions.js`, write naming the versions. One retry, then "Someone else changed the data at the same moment. Nothing was saved."
- **Run patches apply once:** only when the run's `finished_runs` row is absent; otherwise the report is rebuilt from the stored result. Deleting the row re-applies.
- **Token:** `CLOUDFLARE_API_TOKEN` (GitHub secret, D1 edit only) goes only to trusted script steps: search `setup`/`finish`, recover-dropped, ask/fill/triage/find-boards `prepare`/`finish`, check-postings, resolve-links, sweep, merge-master, tune `prepare`/`finish`, rescore `prepare`/`finish`, tune-apply. Never to a job that runs a model.
- **New table:** add it to `TABLES`, the `writeRows` table list and the UNIQUE regex in `lib/store.js`, plus `db/schema.sql`. Run `npx wrangler d1 execute job-search --remote --file db/schema.sql` before `pnpm run deploy`.
- **Backup:** `check-postings.yml` (twice daily) exports `data/*.jsonl` and commits. D1 Time Travel covers 7 days. There is no loader from the export back to D1.

## How it fits together

```
GitHub Actions on the owner's machine (self-hosted runner, polls outbound)
  search.yml   setup -> search (1-2 searchers) -> review (optional) -> finish
  ask.yml / fill.yml           prepare -> model -> finish
  kit*.yml                     model -> finish
  sweep.yml, check-postings.yml, resolve-links.yml, merge-master.yml   scripts only
        | D1 writes from trusted jobs only; git commits for runs/, asks/, applications/, data/
        v
Cloudflare Pages Functions (functions/): Access JWT on every request, D1 binding, GitHub API
        ^ same-origin JSON
React page (web/), hash router
```

- **Trust split.** A job that runs a model holds no token and runs no repo code afterwards. It uploads named, size-capped output files. A separate job checks out fresh, collects them through `bin/collect-output.sh` and runs the trusted step.
- **Runners:** one or more on the owner's machine (`~/actions-runner*`, auto-update on). GPU models still queue on the `flock`. The opencode and agy policies deny the secret files of every `~/actions-runner*` folder (`runnerRoots`), so a new runner folder is covered by its name.
- **Accepted risk:** model CLIs run as the owner's Linux user and read untrusted pages. `bin/`, runner files and `.env` are owner-writable. agy is not contained at all (writes anywhere, runs shell).
- **Schedule (UTC):** `data/schedule.json` says which runs start on their own, keyed by `WORKFLOWS` id plus `check-postings` (`days` 0-6 Sunday 0 or null, `hours`); `lib/schedule.js` (`dueAt`, `dueSince`, `dispatchOf`). `schedule.yml` ticks hourly at :05 and `bin/schedule-tick.js` dispatches what is due with `gh workflow run`. GitHub drops cron ticks, so a tick also catches up any slot from the last 6 hours that has no run of that workflow since (`gh run list`). No other workflow has a `schedule:` trigger; `sweep.yml` dispatches `triage.yml` as its last step. The page reads the file (`useSchedule`). Keep the setup step's `wf`, `run-name` (`search <kind>`) and `WORKFLOWS` in `web/src/components/SearchesPanel.tsx` together.

### Search run

1. **setup** (token): `bin/prepare.js` (`prepareRun`) reads D1, writes `context.json`, `base.jsonl` and `company-state.jsonl`. `tracked` sweeps due boards and queues up to 30 unjudged roles (`SWEEP_ROLES_PER_RUN`) after the sweep filter. `bin/route.js` resolves searchers and reviewer into `route.json`, trimming context for local models over budget (`lib/budget.js`). `daily`/`vertical`/`culture` context carries `recentQueries`: the `## Queries` lines from the last 5 runs' model `report.md`, so searchers pick new angles. Retries reuse the frozen prep artifacts.
2. **search** (per searcher, no token): `bin/run-model.sh <id> prompts/search.md` writes `candidates.json`, `ledger-patch.json`, `coverage.json`, `pending.json`, `report.md`, `status.txt`.
3. **review** (only with a reviewer): `bin/review-input.js` gives each reviewer every find it did not make; `prompts/review.md` writes `review/<id>.json`.
4. **finish** (token): `lib/run.js` `finishRun` merges finds, applies patches against `base.jsonl`, writes D1 and `finished_runs` in one batch, then `report.json`, `report.md`, `runs/index.json`. `bin/finish-push.sh` commits, redoing on a moved `main`.

Run folders: `runs/YYYY-MM-DD-<workflow>-HHMMSS`. `job` runs screen one posting the owner gave (`searchJob`/`reviewJob`). `directed` runs follow the owner's typed direction (dispatch input `topic`, kept as `topic` in `report.json` and `runs/index.json`, run-name `directed <text>`); the Directed page lists them as folds.

### Merge and patch rules (`lib/`)

- **Leads** (`mergeCandidates.js`): one lead per posting, matched by board job id or `leadKey` (company + normalized role). Different roles at one company stay separate. When searchers disagree, a lead verdict beats a pass. Every searcher's and reviewer's opinion rides along in `lead.opinions`; reviews never change verdicts or data.
- **Patches** (`applyPatches.js`), per field, first searcher in route order with a value wins. Guards:
  - Protected company (active application or Ruled out): no company field changes. Postings still update.
  - Stale: a field whose current value differs from `base.jsonl` is skipped and listed in the report. No `base.jsonl`: nothing is written.
  - Stance: a model may change an empty stance or one a model set (`stanceBy`). An owner-set stance (no `stanceBy`) never changes. `To review` never changes. Owner stance actions clear `stanceBy`.
  - A model's Ruled out is never applied: it is saved as `ruleOutSuggested: { by, reason }` and shown on Passed → Companies with Rule out (`setStance`, which clears it) and Keep (`keepCompany`: the stance becomes the owner's, Watching if empty, so runs stop suggesting).
  - Links fill empty fields only. `rolesSkipped` is add-only.
  - A searcher that did not finish `ok` contributes nothing.
- **Undo** reverts a run's change to a company when each field still equals its `to` value. Fact fills from finds are logged as changes too.
- **Postings** (`postingId.js`): board id when the URL has one (`greenhouse:`, `lever:`, `ashby:`, `workday:`), else `key:<FNV-1a of leadKey>`. Job state follows the posting id or `leadKey`.
- **Model output is untrusted:** read only through `readModelOutput.js` with caps from `lib/caps.js` (40 candidates per model, 20 new companies per searcher, per-field limits). Statuses: `ok`, `failed`, `auth`, `limit`.
- **Per-lead fields:** nine checks (`lib/checks.js`), `assessment`, `payEstimate` (always unverified, never counts toward the pay floor).
- Reports before 2026-11-20 may carry `disputed`, `held` and top-level `claude`/`codex` opinions; the Runs page still renders them.
- **Fit score:** each candidate carries `fit` 1-5 (rubric in `prompts/search.md`); several searchers give the highest; postings store it. New sorts leads into Strong fit, Good fit, Maybe, Low fit (2 or below) and Not scored, every bucket open.

### Scripts (no model)

- **Sweep** (`bin/sweep.js`, `lib/boardSweep.js`, `lib/sweepPostings.js`): lists the owner's roles (any level; `roleTest` from `roleWords`/`roleNotWords`, engineering by default, then `titleDrop` words) on tracked companies' public boards (Greenhouse, Lever, Ashby, BambooHR, Breezy, Workable, Pinpoint, Rippling, Workday (POST, 10 pages), Gem, SmartRecruiters, Recruitee, Personio, and by page parsing Paylocity, Teamtailor RSS, ApplyToJob/JazzHR). A company with no known board but a careers link gets its page read (`pageOf`, kind `page`, ids `page:<fnv1a(url)>`): engineering-looking job links, minus nav and docs links. A page drawn by script reads as empty; the tracked rotation still covers those. New roles arrive unjudged (`modelSays: ''`) unless `data/sweep-filter.json` rejects them (`modelSays: 'pass'`, `filteredBy`, `filterReason`). A new filter version re-checks still-listed filtered roles. Still-listed roles get `lastRun` touched daily so the monthly prune keeps them. `sweepOff` companies are skipped. Dormant companies are swept only on the 1st of the month and get no `tracked` rotation slot unless they have a lead or application (`dueTargets`). Finish never passes a swept role on its own.
- **Posting check** (`bin/check-postings.js`, `lib/postingCheck.js`): `readPosting` is shared with triage. Greenhouse/Lever/Ashby by API; Workday, Rippling, BambooHR, Workable, SmartRecruiters by their job-detail APIs; Gem and Recruitee from their board lists; other pages by 404/410, closed phrases or the title in HTML, else `unknown`. Public hosts only; redirects followed by hand.
- **Browser board finder** (`find-boards.yml`, scheduled in `data/schedule.json`, or Run now): prepare (token) lists tracked companies with a page and no known board (`browserTargets`); render (no token, `pnpm install` then `bin/find-boards-render.mjs`) opens each page in headless Chromium from `~/.cache/ms-playwright` and saves every URL it requested or linked to; finish (token, `bin/find-boards-finish.js`) maps them to one board (`boardFromUrl`, `pickBoard`: board links and board API calls), keeps it only if its API answers, and sets `jobsUrl`. ~425 pages in ~6 minutes.
- **Board resolver** (`bin/resolve-links.js`, `lib/boardResolve.js`): finds one embedded board behind a careers page (short forms, or any full link `boardOf` reads) and sets `jobsUrl`.
- **Recover dropped** (`recover-dropped.yml`, by hand; `bin/recover-dropped.js`, `recoverDropped` in `lib/run.js`): adds the companies and finds a finished run dropped for the new-company limit, from its committed model outputs. Patches only for companies still missing; finds attach under the original run. Once per run (`recover:<run>` in `finished_runs`).
- **Coverage:** when the owner adds a job by hand (`addJob`, `searchJob`), the handler records on the job entry whether the search had seen it (`unseen`, `unjudged`, `filtered`, `passed`, `lead`). The Runs page shows the counts. A posting pruned after a month off its board reads as `unseen`.

### Title triage (after every sweep)

- `triage.yml` (`workflow_run` after `sweep`, or Run now in Searches; dispatch input `filtered: true` triages the sweep filter's drops instead).
- `bin/triage-prepare.js` (`lib/triage.js`) picks up to 80 unjudged swept roles with no `triage` (250 filtered ones), reads each posting (Greenhouse/Lever job API, Ashby board API, else page text from the title on, 2,500 chars) and marks dead ones gone (`posted: 'no'`, `goneAt`). The model (`defaults.searches.triage`, else the search default) reads `prompts/triage.md` and writes `triage.json`. `bin/triage-finish.js` applies it once per run (`finished_runs` `triage:<at>`).
- Posting field `triage: { by, at, keep, fit?, reason }`. A drop is `modelSays: 'pass'`, shown under Filtered on Passed ("Triaged out"), not counted. A kept filtered role loses `filteredBy` and goes back to unjudged. `selectRoles` gives kept roles the tracked judging slots first, highest fit first.

### Tune (weekly, from the owner's reasons)

- `tune.yml` (scheduled in `data/schedule.json`, or Run now in Searches): `bin/tune-prepare.js` collects reasons since the last tune (`finished_runs` `tune:<at>`); none means the model never runs. The model (`defaults.searches.tune`, else the search default) reads `prompts/tune.md` and writes `proposals.json`. `bin/tune-finish.js` (`lib/tune.js`) keeps up to 8 whose `find` occurs exactly once in an allowed file and saves them with the file's git blob sha.
- Apply (`applyTune`, confirms first) sets `applying` and dispatches `tune-apply.yml`, which refuses (`stale`) if the file's sha moved, else commits the one edit with push retry and marks `applied`.

### Re-check (rescore)

- `rescore.yml` (dispatch only, `runSearch` workflow `rescore`): `bin/rescore-prepare.js` lists saved, applying and flagged jobs that have a posting row, at companies not Ruled out and without an application for the posting, with their companies' stored text and owner notes; none means the model never runs. The model reads only that and the rules, no web.
- `bin/rescore-finish.js` (`lib/rescore.js`) writes one batch: each posting's `fit` and `rescore` (`fitFrom/To`, `fingerprintFrom/To`, `why`), a company event per moved score, and the company's new `fingerprint` text. Once per run (`rescore:<at>`); rows are re-read at finish, one retry on 409.
- Rescore and follow-up run `run-model.sh` with `NO_WEB=1` (claude and codex lose their web tools; opencode and agy don't).
- A local model set as `defaults.searches.rescore` is not trimmed for its context budget, so it may refuse; the run then fails with "did not finish ok".
- Guards: the fingerprint text is skipped (counted) for a company with an active application or Ruled out, or whose fingerprint changed since prepare. Text must start with its score.

### Ask, fill, kits, supplement

- **Ask** (`ask.yml`): one question about one company to a registry model or `both` (Claude and Codex, separately). A reply may carry a patch, saved as a `proposal` the owner applies or dismisses.
- **Fill** (`fill.yml`): fills only empty fact fields (`FACT_FIELDS`).
- **Follow-up** (`followup.yml`, `followup` action): Claude drafts a stage-fitting email for an open application from its stored fields (`sendTo` via `setSendTo`), saved as `followups/<kit folder name>-<last 12 of the application id slug>/followup-N.md` (one folder per application; `followUpName` in `web/src/data.ts` and `followup.yml` build it alike). Nothing is sent. The handler builds the inputs; only `note` comes from the page. Draft follow-up shows when `needsFollowUp`, or from the card's Actions menu.
- **Kits stay Claude/Codex only** (kit, kit-review, kit-revise, kit-add). With one of them off: ask and kit-review `both` run only the one on, `kit.yml` drafts one round with no critique, and the page hides the off one.
- Kit folders are named by company and role, and `kit.yml` replaces the whole folder. The `kit` action refuses when the folder exists, unless the kit page's rerun sends `replace`; it always refuses for another posting with the same title.
- `kit.yml` drafts and critiques; `kit-review.yml` reviews the latest draft (never edits it); `kit-revise.yml` writes the next `draft-N.md` and `resume.docx`; `kit-add.yml` adds a cover letter or answers. `bin/page-count.sh` checks the two-page target.
- **Supplement:** reviewer `questions` answered on the kit page become `supplement` rows. Open facts go to kit prompts as `SUPPLEMENT_BLOCK`. The Master page merges one into `master-resume.md` through `merge-master.yml`.
- Ask and fill D1 ids include a dispatch-time `at`, so a retried finish records nothing twice.

## Models

- **Registry** (`lib/models.js` `loadModels`): `models` entries `{ id, label, runner, model?, ctx?, enabled?, missing?, instructions? }`; `defaults` `search: { searchers, reviewer }`, optional `searches.<workflow>` (a whole entry), `ask`, `fill`. Runners: `claude`, `codex`, `opencode` (needs `model`), `agy`. Ids match `^[a-z0-9][a-z0-9-]{0,29}$`; `both`, `owner`, `review`, `incoming`, `none`, `each` are reserved. Bad entries are dropped silently. A model turned off (`enabled: false`) drops out of every default: off searchers go, an off reviewer (or one left as the sole searcher) becomes `none`, ask `both` becomes `claude`. A broken file falls back to Claude alone, no review. A disabled default with a disabled fallback fails setup with a message naming it.
- **Routes:** 1-2 searchers plus a reviewer: `'none'`, a model id, or `null` ("each other": with two searchers each reviews the other's finds). A model never reviews its own finds. `route.json` holds `{ searchers, reviewer, trimmed? }`; a missing one reads as legacy Claude + Codex. Old routes may carry `advisory`; it is ignored.
- **Failure = report and stop.** No fallback model. `run-model.sh` writes why beside `status.txt` (`reason.txt`: timed out, exit code, limit, auth, writes blocked); `readModelOutput` adds its own (no `candidates.json`, bad JSON). The report's `models[id].reason` shows on the run page, a "failed" tag on Runs, and Status ("Searchers that failed", counted in the bar's red dot) since GitHub calls those runs a success.
- **opencode:** permissions built per call (`lib/opencodeConfig.js`) and passed as `OPENCODE_CONFIG_CONTENT`. Edit rules match the path as the model wrote it, so the output folder is allowed by absolute and repo-relative path (verified on opencode 1.18.30). `llama-local/` models queue on `flock /tmp/job-search-gpu.lock`, then `swap-model`. Permission keys are unverified (an unknown key is ignored silently).
- **agy:** `bin/agy-run.sh` writes a session-only settings file from `lib/agyPolicy.js`. Deny rules apply; write and shell limits do not. Deny targets must not be globs. `agy -p` may hang with no TTY: the script stops it once outputs are idle for `AGY_IDLE` (300 s).
- **Context budget** (`lib/budget.js`): tokens = chars/4, limit 60% of `ctx`. `run-model.sh` refuses over budget (`refused.txt`).
- **Page pickers** (`web/src/components/ModelPicker.tsx`, `web/src/models.ts`) mirror the server's default cleaning and send `searchers`/`reviewer` only when they differ from the defaults.
- `bin/sync-models.js` (by hand) syncs `llama-local/` aliases from the owner's model config. Owner checklist: `docs/model-routing-owner-checklist.md`.

## The page

- **Stack:** React 19, TypeScript, Vite, `createHashRouter`, TanStack Query, Vitest + Testing Library. Base UI (`@base-ui/react`) for every widget; shared wrappers live in `web/src/components/ui.tsx` (`Fold`, `Choice`, `Tip`, `Button`, `Popup`, `Tabs`), one-off menus and cards may import Base UI directly. No native `<dialog>`, `<details>`, `<select>`, `window.confirm` or `title=` tooltips.
- **Data:** `/api/companies` and `/api/postings` page JSON Lines (`?after=`, `x-next-after`); a failed page fails the load. Refetches ask `?since=` (delta reads); an action's reply carries the rows it `written`, patched into the cache. Hooks in `web/src/data.ts`.
- **Routes:** `#/new` (default), `/jobs`, `/jobs/:id`, `/applications`, `/companies`, `/companies/:key`, `/passed`, `/directed`, `/runs`, `/runs/:run`, `/status`, `/kits`, `/kits/:name`, `/master`, `/settings` (tabs Reasons, Job titles, Profile; title matching shared with the sweep through `lib/titleWords.js`).
- **Bar** (`AppBar.tsx`): Search opens a popup (`/`, Ctrl/⌘-K) with Companies, Jobs and Go to. Directed, Runs, Kits and Master sit under More ▾ (Searches too below 1100px). Status shows a dot for running or failed runs (`web/src/status.ts`); visiting Status marks failures seen.
- **Job pane** (`JobPanel`): a pinned top line (company, tags, buttons) over the `Scorecard` (pay against the floor, fit, merged checks); open applications show `StageControls` there. Then tabs Job, Company, Ask, History.
- **Applications:** a pipeline board. Columns Applied, Screening, Interviewing, Offer from `stage`; a Closed column counts outcomes and lists closed cards. Cards set stage (`setStage`) and next step (`setNextStep`). `needsFollowUp` (`web/src/pipeline.ts`) shows amber "Follow up?". Cards don't drag.
- **Pay floor:** `payRange`/`belowFloor` (`web/src/format.ts`) compare against `payFloor` from `data/profile.json` (`useFloor()` in `web/src/data.ts`; null when unset) and compare only yearly US dollars; hourly/monthly units next to the range, other currencies and estimates stay text, never amber.
- **New** (`lib/newQueue.js`): tune proposals (`TuneBox`), new leads (fit buckets, all open, one list across runs), swept roles not reviewed, possible duplicates, postings taken down, proposals. Only an owner action moves an item out.
- **Skip / Save** (`Decide.tsx`): the first click opens one-tap reasons in a popover; a chip, Other, or "without a reason" sends it. Job entries keep every reason in `reasons: [{ state, reason, at }]`.
- **Passed:** model passes (counted in the nav) and a Filtered chip for sweep-filter passes (not counted).
- **Actions:** one endpoint, `POST /api/action` (`functions/lib/handlers.js`). The `ACTIONS` registry (`web/src/actions.ts`) drives `ActionModal`, `OpenAction` and `Actions ▾`. Confirm before: Rule out, a stance change or second application with an active application, Delete application, Merge companies.
- **Working status:** `useActiveRuns` matches workflow `run-name` titles (`ask <company>`, `job <company> | <role>`, `kit ...`, `review ...`, `revise ...`, `piece ...`). Change a title and the page stops matching.
- **Times** are shown in the browser's zone (`web/src/format.ts`). Page tests pin `TZ` to America/New_York.
- **Safety:** model text renders as text nodes; `safeHref` allows only http(s) and same-site; `RichText` renders only links and bold.
- Every row tied to a position shows its posting link (`PostingLink`; New's rows have it in the pane). Company-wide actions confirm first; a single role is skipped with "Skip this role". A re-render must not lose scroll or typed text.
- **Design:** use the frontend-design and design-taste-frontend skills before any new page layout or a visual change you choose yourself, not before CSS tweaks the owner specifies.
- **Backend secrets** (Cloudflare, never in the repo): `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `GITHUB_REPO`, `GITHUB_TOKEN`, `OWNER_EMAIL`.

## Commands

```bash
pnpm install
pnpm test          # node --test test/ (pipeline, store, backend) and vitest run (page)
pnpm run build     # tsc -p web && vite build
pnpm run deploy    # vite build, wrangler pages deploy dist
npx tsc -p web
pnpm run preview   # dist/ on localhost:8099 with repo files behind /api/* (writes discarded)
node dev/shot.mjs '#/new' out.png [width] [height]   # screenshot + console errors
pkill -f 'node dev/preview-serve[r].mjs'
npx wrangler d1 execute job-search --remote --json --command "select ..."   # read live D1 (json_extract works)
ruby -ryaml -e 'YAML.load_file(".github/workflows/x.yml")'   # validate workflow YAML
sudo ~/actions-runner/svc.sh status|start|stop   # each runner folder has its own svc.sh
```

- Live D1 queries: by key or single-table only. Analysis (joins, `exists` per row, cross-table counts) runs on `data/*.jsonl` after `git pull`, or after a fresh `node bin/export-data.js .` (~2,600 reads). One join across companies × postings costs ~1M reads, a fifth of the free daily limit.
- Node 26, ESM. Pipeline and backend have zero npm dependencies. Plain JS (4-space indent) in `lib/`, `bin/`, `functions/`; TypeScript only in `web/`.
- Backend tests use `test/sqliteD1.js` as the D1 stand-in. The `playwright` import resolves only under `dev/`.
- The preview's data rarely covers a new state: a throwaway `dev/tmp-*.mjs` uses Playwright `page.route('**/api/postings*', …)` to inject fixture rows, then screenshots. Delete it after.
- Hover, tab clicks, scrolled states and run cards need the same throwaway script (`locator.hover()`, `getByRole('tab').click()`, `page.route('**/api/status*', …)` for running runs).
- Page-test quirks: Base UI popups mount late (`await findByRole`), a closing menu blocks a second `userEvent.click` (use `fireEvent.click`), toasts have `role="dialog"`.
- Dependency versions: newest release at least two weeks old.
- Privacy: the owner's email never goes in code or to outside services. Secrets only through `gh secret set` or `wrangler pages secret put` in the owner's terminal; variables through `gh api -X POST repos/<repo>/actions/variables -f name=… -f value=…` (old gh has no `gh variable`).

## Gotchas that have bitten before

- **YAML plain scalars with `: `** break a workflow (dispatch then returns 422). Use `run: |`.
- **`upload-artifact` skips hidden folders** (`.review/`) unless `include-hidden-files: true`.
- **`claude -p`:** prompt on stdin (`--add-dir` swallows a trailing argument); run from the repo directory. `codex --search` goes before `exec`.
- **`run-model.sh`** judges success from the last 15 log lines only ("401(k)" once read as an auth failure).
- **Persist-credentials is off** on checkouts; pushes pass the token explicitly.
- **A D1 batch aborts whole.** Don't split one logical change across batches.
- **The stale guard depends on SQLite's CHECK message** (`CHECK constraint failed: ok`). Re-test the stale path after any D1 change.
- **`base.jsonl` never leaves the runner's artifacts.** A finish without it writes no company field.
- **The daily export overwrites `data/*.jsonl`,** even when D1 returns nothing.
- **Browser caching:** `web/public/_headers` sets `no-cache` on HTML, long cache only on hashed assets.
- **The top bar is `white-space: nowrap`** (`.bar-in`), and `StatusBar` cards render inside it: anything there that should wrap sets `white-space: normal`.
- **`style.css` reuses short class names** (`.running`, `.dot`, `.status`): give a new element a prefixed class (`bar-dot-running`), not a second generic one.
- **Names differing by a suffix** (Acme / Acme PBC) don't match by script; use Merge companies.
- **Test files define helpers between tests.** Deleting a test block can take a helper with it. Grep for the helper after removing tests.
- **Prompt injection:** model CLIs read untrusted pages on the owner's machine and logins.

## Known loose ends

- Deferred minors: `keepSeparate` doesn't check its target; `saveJob` with an active application sets Watching without a confirm; `getLines` has no repeated-cursor stop; `useAct` has no in-flight guard; `AskPanel` keys proposals by index; `finish-push.sh` parses `route.json` with an inline parser.
- JWT check has no `nbf` check, and an unknown `kid` doesn't refetch certs.
- Kits: a failed kit run is silent on the page. `pandoc --sandbox` in `render-kit.sh` is not done.
- Local models and agy are unverified until the owner's checklist passes.
