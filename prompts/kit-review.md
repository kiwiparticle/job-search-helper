You are reviewing an existing application draft for one job posting. Be strict and specific. Do not rewrite it.

Read `master-resume.md` (facts in the owner-facts block below count as true too), `docs/resume-cover-letter-guidelines.md` (the owner's rules for resumes and cover letters; follow every one), `instructions.md` (section "Technical fit"), and in `{{OUT}}/`: `posting.md` and the draft files (`draft.md`, plus `cover-letter.md` and `answers.md` if present).

{{NOTE_BLOCK}}

{{SUPPLEMENT_BLOCK}}

Run `{{REPO}}/bin/page-count.sh {{OUT}}/draft.md` and note under Format if the resume is not two pages with the last page 85% or more full (if the script fails, say so). Check five things:
1. **Fit.** Does it lead with what this posting cares most about? What should move up, move down or go? Is the summary strong and specific, per the guidelines' Summary section? Never recommend cutting it below that length or adding a qualifier that weakens a claim.
2. **Filters.** List the posting's must-have terms: skills, tools, titles, domain words. For each, say whether the draft uses it in words a keyword scanner would match. A term the master can't support is `not-in-master`, and must not be added.
3. **Format.** Flag any break from the structure: `# Name`, title line, contact line, `##` sections, `### Job Title, Company | Dates`, Skills lines as `**Category Name:** Skill, ...` with a capital first skill.
4. **Voice.** Flag every break of the guidelines file (semicolons, colons in prose, needless hyphens, banned phrases, first person in a resume, years of experience), buzzwords, jargon, bullets that copy the master's sentences when plainer wording would do, stock phrases from the master, and sentences that read like a keyword list. Suggest plainer wording.
5. **Truth.** Flag changes of fact, and quote them: a claim, number, skill, tool, outcome or title that isn't in `master-resume.md` or the owner facts, or contradicts them, a claim made bigger than the master makes it ("helped" to "drove"), or two facts joined into a third. Different wording of the same fact is fine and is never a Truth problem. That's the most serious problem.

Write two files in `{{OUT}}/`:
- `review.md`: the review, grouped Fit / Filters / Format / Voice / Truth, most important first. Under 600 words.
- `review.json`:
  ```json
  {
    "keywords": [{ "term": "PHP", "state": "used" }],
    "truth": ["each unsupported claim, quoted, or empty"],
    "questions": [{ "question": "one clear question for the owner", "why": "what a yes would let the resume say" }]
  }
  ```
  `questions`: at most 5. Ask only what could make the resume stronger and true: a posting requirement the master is silent on (did they use it?), or a thin or unclear item they could expand. Never ask what the master or owner facts already answer. Use an empty list when there's nothing worth asking.
  `state` is `used`, `missing` (the master supports it but the draft doesn't use it) or `not-in-master`.

Write only those two files.
