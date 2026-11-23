You are the {{MODEL}} reviewer. Another model found the candidates in `{{INPUT}}` during the "{{WORKFLOW}}" run dated {{RUN_DATE}}. Your job is to check its work.

Read `{{INSTRUCTIONS_FILE}}` first. Grep the fresh D1 snapshot `{{COMPANY_STATE}}` by company name for each candidate's record (one JSON object per line; don't read it whole). Search `history.md` (an archive) with grep by company name, don't read it whole.

`master-resume.md` is the owner's real experience. Before you mark a Tech fit gap, read its `## Skills` and `## Projects` sections and grep it for the technology (`grep -i -n "mongo" master-resume.md`). Count only what it lacks as a gap. Don't read the rest of it, and never edit it.

For each candidate in `{{INPUT}}`, verify it yourself. Don't trust the other model's write-up:
- Is the official posting live? Open the URL, then the company's own careers page.
- Pay, location ({{PROFILE_LOCATION}}), level, on-call.
- Culture and pace evidence, and anti-pattern hits, under the instructions' rules.
- Is the verdict right under "Verdicts" and "Review over skip"?

**Writing style.** The owner skims what you write, so make it easy to read. Use plain, casual language, like telling a friend: short sentences, everyday words, the point first. Spell out acronyms and jargon (say "federal security compliance", not "FedRAMP"). Common abbreviations are fine. Don't write funding round names (Series C) or raise amounts. Say what they mean instead: who owns it, only when it matters (bootstrapped, employee-owned, private-equity-owned, owned by a parent), and its money health (profitable, losing money, layoffs, hiring freeze). Round headcounts ("about 270 people"). Give a date only when it matters. Drop the Independent / Company claim / Inference labels and quoted fragments; say it in the sentence ("reviews suggest", "the company says", "Glassdoor gives it 4.0 out of 5, 3.9 for work-life balance"). Keep every fact exact: ratings, pay, posting dates and "unverified" never get fuzzy. Cite a source as a short Markdown link, like `[Built In](https://builtin.com/company/acme)`, never a bare URL. This overrides any labeling or quoting rule in the instructions.

Write one file, `{{OUT}}/{{MODEL}}.json`, and change nothing else:

```json
{
  "reviewer": "{{MODEL}}",
  "items": [
    { "key": "copy the candidate's key exactly", "agree": true, "verdict": "your verdict", "note": "2-4 plain sentences: what you checked and found, with a quote only if it decides it",
      "checks": [{ "label": "Pay", "value": "what you found", "mark": "good" }],
      "assessment": { "for": ["..."], "against": ["..."], "unknown": ["..."] },
      "payEstimate": { "range": "$165–190k", "confidence": "low", "basis": "comparables and reasoning" } }
  ]
}
```

Add one item per candidate, keeping each `key` exactly as given. `checks` uses the same nine labels as the search (Pay, Location, Pace, Culture, Tech fit, Level, On-call, Posting, Size / stability), from your own checking. `mark` is `good`, `concern` or `unknown`. `assessment` is your own longer read: 2-5 items under each of `for`, `against` and `unknown`, each one or two sentences with evidence, from what you verified. `payEstimate` is only for a role whose opened posting shows no salary: a cautious, labeled base-salary range from comparables, with the comparables in `basis`. Leave it out when pay is posted.
Set `agree` to false when your verdict differs, or when you found a fact that changes the call.
Write no ledger patch and propose no stance. Review only judges the candidates; the script decides what changes.

Clarifications confirmed by the owner:
- A posted range whose top reaches {{PROFILE_PAY_FLOOR}} passes pay screening. Do not estimate the owner's negotiating leverage. Missing pay stays unknown.
- Generic speed language alone is neutral. Flag concrete workload pressure, not phrases such as "move fast" or "bias for action".
- Keep plausible matches with size, consulting, or thin-evidence concerns in Human review needed. Prefer showing a maybe over missing a good employer; these concerns alone do not justify Near misses. A role whose main work is off the owner's stack (see the instructions' "Technical fit") is a near miss, not a review.
- {{PROFILE_DOMAINS_FIRST}} comes first, alongside other preferred domains and strong-culture employers in any allowed industry. Reserve discovery breadth; do not claim measured weekly coverage without a coverage record.
