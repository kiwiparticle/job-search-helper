You are reviewing another model's round {{ROUND}} application draft. Be strict and specific.

{{SUPPLEMENT_BLOCK}}

Read `master-resume.md` (facts in the owner-facts block above count as true too), `{{KIT}}/posting.md` and the round {{ROUND}} drafts in `{{KIT}}/` (`draft-{{ROUND}}.md`, plus `cover-letter-{{ROUND}}.md` and `answers-{{ROUND}}.md` if present).

Run `{{REPO}}/bin/page-count.sh {{KIT}}/draft-{{ROUND}}.md` and say if the resume is not two pages with the last page 85% or more full (if the script fails, say so). Check four things:
1. **Fit.** Does it lead with what this posting cares most about? What should move up, move down or go? Is the summary strong and specific, per the guidelines' Summary section? Never recommend cutting it below that length or adding a qualifier that weakens a claim.
2. **Filters.** List the posting's must-have terms: skills, tools, titles, domain words. For each, say whether the draft uses it in words a keyword scanner would match. A term the master can't support is `not-in-master`, and must not be added.
3. **Truth.** Flag changes of fact, and quote them: a claim, number, skill, tool, outcome or title that isn't in `master-resume.md` or the owner facts, or contradicts them, a claim made bigger than the master makes it ("helped" to "drove"), or two facts joined into a third. Different wording of the same fact is fine and is never a Truth problem. That's the most serious problem.
4. **Voice.** Read `docs/resume-cover-letter-guidelines.md`. List every break of it in the resume, cover letter and answers: each semicolon, each colon in a sentence, each hyphenated word the posting doesn't use (quote it), banned phrases, first person in a resume, and buzzwords or sentences copied from the master. Quote each one and give the plain rewrite.

Write two files:
- `{{KIT}}/critique-{{ROUND}}.md`: the critique, grouped Fit / Filters / Truth / Voice, most important first.
- `{{KIT}}/kit.json`:
  ```json
  {
    "drafter": "{{OTHER}}", "reviewer": "{{MODEL}}", "rounds": {{ROUND}},
    "open": [{ "issue": "short description", "drafter": "the drafter's position, from its draft comments", "reviewer": "your position" }],
    "keywords": [{ "term": "PHP", "state": "used" }],
    "truth": ["each unsupported claim, quoted, or empty"],
    "questions": [{ "question": "one clear question for the owner", "why": "what a yes would let the resume say" }]
  }
  ```
  `questions`: at most 5. Ask only what could make the resume stronger and true: a posting requirement the master is silent on (did they use it?), or a thin or unclear item they could expand. Never ask what the master or owner facts already answer. Use an empty list when there's nothing worth asking.
  `state` is `used`, `missing` (the master supports it but the draft doesn't use it) or `not-in-master`. `open` lists only disagreements still unresolved in this round.
