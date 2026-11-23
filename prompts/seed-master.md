Build `master-resume.md`: the single source of true facts for every future resume.

The owner's tailored resumes, converted to Markdown, are in `{{OUT}}/src/`. Each one angles the same career differently. Merge them into one complete file.

Rules:
- Keep every fact that appears in any resume: jobs, dates, titles, bullets, numbers, projects, skills, education, coursework.
- When the same fact appears with different numbers, keep the newest/largest one, which reflects growth over time. For example, "shipped ~12 releases/quarter" vs "shipped ~20 releases/quarter" → ~20.
- When the same fact is worded with different detail, keep the fullest true wording. For example, "rebuilt the billing page in React, cutting load time from 4s to 1s" beats "rebuilt the billing page".
- Keep facts that only some versions include, like a team someone led or a tool they introduced.
- Don't add, infer or embellish anything.
- After each bullet, add a source note listing the resume files it came from, like `<!-- src: acme-staff, globex-senior -->`.
- Layout: contact header, then sections Experience (newest first, every bullet each job has ever had), Projects, Skills (grouped), any other section the resumes share, Education, Certifications.
- At the top, add a short "Conflicts" list. It names every place you picked one version over another, quoting both.

Write the result to `{{OUT}}/master-resume.md` and nothing else.
