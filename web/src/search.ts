import type { Company, Posting } from './model';

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Case- and punctuation-insensitive. Companies match by name or alias, jobs by company + role. At most 6 of each.
export function searchAll(companies: Company[], postings: Posting[], q: string) {
    const needle = fold(q);
    const out = { companies: [] as Company[], jobs: [] as { company: Company; posting: Posting }[] };
    if (!needle) return out;
    for (const company of companies) {
        if (out.companies.length < 6 && [company.name, ...company.aliases].some((n) => fold(n).includes(needle))) out.companies.push(company);
        for (const posting of postings.filter((p) => p.companyKey === company.key)) {
            if (out.jobs.length < 6 && fold(`${company.name} ${posting.role}`).includes(needle)) out.jobs.push({ company, posting });
        }
    }
    return out;
}
