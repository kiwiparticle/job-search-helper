You are revising one resume draft for one job posting. Apply the reviewers' recommendations and critique and the owner's note. Change only what they ask for, and keep the rest as it is.

Read:
- `master-resume.md`: the main source of facts about the candidate. See Facts and wording below.
- `docs/resume-cover-letter-guidelines.md` (the owner's rules for resumes and cover letters; follow every one). Where the master's wording breaks a rule, rephrase it.
- `docs/positioning.md`: what to lead with for this posting's industry. It picks and orders facts. It is never a source of facts.
- `{{OUT}}/posting.md`: the job posting.
- `{{OUT}}/draft.md`: the current draft.
- `{{OUT}}/review-claude.md` and `{{OUT}}/review-codex.md`, if present: reviews of the current draft.
- `{{OUT}}/critique.md`, if present: the reviewer's latest critique from the kit's rounds. It may be older than the draft, so apply only the points that still hold.

{{NOTE_BLOCK}}

{{SUPPLEMENT_BLOCK}}

Where the reviewers disagree, or a recommendation would add something the master doesn't support, use your judgment, keep the draft true to the master, and say so in one line in an HTML comment at the top.

**Facts and wording.** `master-resume.md` is the main source of facts: what was done, numbers, scope, level of ownership, titles, tools and dates. Facts the owner supplied (the owner-facts block above, and anything the owner's note states as true) count as true too, and are used the same way. The wording is yours. Reword freely, in your own plain sentences, and leave true facts out when they don't help. Never re-interpret. Don't make a claim bigger ("helped" to "drove", "led" to "owned"), don't add numbers, tools, outcomes or scope the master doesn't state, and don't join two facts into a third. "Led a six-person team" may become "ran a small team". "Ran the team's roadmap" may not. When unsure, stay with the master's claim. Don't make a claim smaller either: state true facts at full strength, with no hedges or self-limiting words.

**Length.** After writing the resume, run `{{REPO}}/bin/page-count.sh {{OUT}}/revised.md`. It prints the page count and how full the last page is. The goal is exactly two pages with the last page 85% to 100% full. If it is shorter, add more true, relevant detail. If it runs over, trim the least relevant. Run it again after each change, at most three times. Never end on three pages. If the script fails, say so in an HTML comment at the top and use about 1,000 to 1,100 words. Don't shorten it unless the owner's note asks.

**Format.** The renderer depends on this structure, so keep it exactly: `# Name`, then a title line, then a contact line, then `##` sections (Summary, Skills, Experience, Projects, Education). Each job is `### Job Title, Company | Dates`. In Skills, each line is `**Category Name:** Skill, skill, skill`: the category in Title Case, and the first skill after the colon starts with a capital letter. Experience bullets are `-` lines. No tables, no extra heading levels, no bold except the Skills labels.

**Before you finish, check the text against the owner's punctuation rules.** No semicolons anywhere. No colons in sentences or bullets (Skills labels excepted). No hyphens joining words unless the posting uses that exact term (such as "full-stack") or it is a standard name: write "real time", "in progress", "industrial monitoring", "hands on" only if the posting spells them that way, otherwise rephrase. Don't copy a hyphenated phrase from the master just because it is there. None of the banned phrases. Fix any you find before writing the file.

**Voice.** Write like a person telling a hiring manager what they did. Plain, specific sentences: what you built, for whom, what changed. No buzzwords, no jargon where an everyday word works, no piles of keywords in sentences. `master-resume.md` is where the facts come from, not a script. Do not copy its sentences: write each bullet fresh from the fact, in plain words. Keyword lists belong in Skills. The summary and bullets read as sentences.

Write the full revised resume as Markdown to `{{OUT}}/revised.md`, in exactly the structure of the draft, so formatting is unchanged unless the owner's note says otherwise. Write only that file.
