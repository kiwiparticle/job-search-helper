import type { Company, Posting } from './model';

// The browser tab title for a route. null means the page sets its own (kit pages load their own data).
export function pageTitle(path: string, ctx: { newCount: number; companies: Company[]; postings: Posting[] }): string | null {
    const [, section = 'new', id] = path.split('/');
    const name = (() => {
        switch (section) {
            case 'new': return ctx.newCount ? `New (${ctx.newCount})` : 'New';
            case 'jobs': {
                if (!id) return 'Jobs';
                const p = ctx.postings.find((x) => x.id === decodeURIComponent(id));
                return p ? `${p.role}, ${ctx.companies.find((c) => c.key === p.companyKey)?.name ?? ''}`.replace(/, $/, '') : 'Job';
            }
            case 'applications': return 'Applications';
            case 'passed': return 'Passed';
            case 'directed': return 'Directed';
            case 'status': return 'Status';
            case 'companies': return id ? ctx.companies.find((c) => c.key === decodeURIComponent(id))?.name ?? 'Company' : 'Companies';
            case 'runs': return id ? `Run ${decodeURIComponent(id)}` : 'Runs';
            case 'master': return 'Master';
            case 'kits': return id ? null : 'Kits';
            default: return 'Job search';
        }
    })();
    return name && `${name} · Job search`;
}
