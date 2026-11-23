# Job Search Agent Instructions

Example rules. Edit every section to match what you want; the search prompts read these headings by name, so keep them.

## Goal
- A full-stack engineering job at a company I could stay at for years.
- Remote or hybrid in the United States, mid-level to senior.
- Small to mid-size teams with a clear product and steady pay.

## Review over skip
- Default to "Human review needed", never to Skip. Only a Hard Skip ends a lead.
- A concern that needs my judgment (size, pace, a learnable stack gap) goes to Human review with the evidence quoted.
- When in doubt between Skip and review, review.

## Hard Skips
Only these end a lead:
1. A company or role on the Never list, or one I have already ruled out.
2. A firm location rule I cannot meet.
3. Documented maximum guaranteed pay clearly below the floor in "Compensation rules".
4. Management-only, contract-only or clearance-required roles.
5. A posting confirmed closed, or an employer identity that contradicts the posting.

Never list: (add companies or kinds of employer here, one per line).

## Cheap triage
Run first on every candidate: headcount, domain, an open engineering role on the company's own site, and pay if a posting states it.

## Hard requirements (check first)
- Fully remote, or hybrid within a commute I can make.
- Located in or open to the United States.
- A senior or mid-level individual-contributor engineering role.

## Unknowns never disqualify
A missing fact (pay, on-call, size) goes to Human review with a question for the recruiter screen. Only documented facts fail a check.

## Compensation rules
- Pay floor: $140,000 base in USD. Use posted pay only; an estimate never counts toward the floor.
- Show variable pay and equity separately from base.

## Level and title
- Target titles: Software Engineer, Senior Software Engineer, Staff Software Engineer, Full-Stack Engineer.
- Not a fit: junior, intern, manager-only. Do not accept a title lower than my level for the pay.

## Work style and benefits
- Remote or hybrid. Normal working hours. Reasonable time off and health coverage.

## Time zones and travel
- Core hours that overlap US Eastern time. Travel up to a few trips a year is fine.

## On-call
- Occasional business-hours support is fine. Regular after-hours on-call is a concern: quote it.

## Stability
- Prefer profitable or well-funded companies. Note layoffs or ownership changes in the last two years.

## Domain tiers
- Top: developer tools, education software.
- Preferred: health IT, logistics, climate and energy software.
- Anything else is fine if the work and culture are strong.

## Company size
- Prefer 20 to 500 people. Smaller or larger is a note, not a skip.

## Technical fit
- Strong match: TypeScript, React, Node, PostgreSQL, APIs.
- Gaps: classify as learnable (similar tool), real (new paradigm) or blocking (core to the role).
- Frame gaps honestly in application materials; never claim skills I lack.

## Company-wide vs. role-specific decisions
- A bad role does not rule out the company: record it as a skipped role. Rule out a whole company only for a company-wide reason.

## Posting freshness
- Confirm the role is live on the company's own site. Flag any posting older than 45 days.

## Search approach
- Weekly culture discovery from the sources list; daily role-first search; weekly vertical sweep.
- Verify the employer and the live role before reporting.

## The culture fingerprint
Score 0 to 5 from evidence, with links: published pay, clear remote policy, calm pace, small autonomous teams, long tenure. Say "unscored" when the evidence is thin.

## Culture evidence
- Prefer the company's own words (handbook, careers page) over review sites. Label each source and keep confidence separate from the score.

## Pace language
- Quote phrases like "fast-paced", "wear many hats" or "hustle" as concerns, not automatic fails.

## Ledger and pipeline output
- Every meaningfully screened company goes in the structured results. Recorded roles are not new leads without new evidence.
- Models may suggest Watching or Dormant only on an empty stance; I set everything else.

## Reporting filter
- Report only openings worth investigating. Do not pad.
- Add a Near misses line for each documented non-match: company, role, main reason, link.
- Size or thin evidence alone never makes a Near miss; those stay in Human review.

## Writing style
Plain, short sentences. Lead with the point. Keep facts exact (pay, dates, sizes, links) and keep "unverified" as "unverified".

## Output (per lead)
**Company — Position**
- **Company:** size, what it does, domain, ownership and stability.
- **Pay:** base range as posted, or "not posted".
- **Location:** remote or hybrid, time zone.
- **Pace:** quoted evidence or "none found".
- **Culture:** labeled evidence and confidence.
- **Tech fit:** overlap and classified gaps.
- **Level:** title and seniority.
- **On-call:** stated, implied or not mentioned.
- **Posting:** confirmed live (yes/no), date, link.
- **Size / stability:** headcount, funding, recent changes.
- **Concerns, Questions for the recruiter screen, Verdict, Link.**

## Verdicts
- **Strong apply:** strong evidence, no hard failure or material red flag.
- **Worth interviewing:** plausible fit, evidence mixed.
- **Human review needed:** a concern needs my judgment; quote it.
- **Interesting but concerning:** real appeal, material evidenced risk.
- **Company worth watching (internal):** good company, no suitable opening now.
- **Skip:** only a Hard Skip.

## Cadence and coverage
- Schedules live in `data/schedule.json` (UTC). Only `tracked` monitors active leads daily.
- Report completed, partial and not-run coverage honestly; omitted work is never a pass.
