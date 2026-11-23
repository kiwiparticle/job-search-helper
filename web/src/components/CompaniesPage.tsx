import { useState } from 'react';
import { CompanyLink } from './CompanyLink';
import { Link, useSearchParams } from 'react-router';
import { useAct, useCompanies, usePostings } from '../data';
import { Chip, LinkRow } from './Tags';
import { Button } from './ui';
import { RichText } from '../text';
import { activeApplication } from '../../../lib/tags.js';
import type { Company } from '../model';
import { isOutstanding } from '../format';
import { InlineForm } from './CompanyPage';

const STATUSES = ['Watching', 'To review', 'Dormant', 'Ruled out', 'Active application', 'Not placed', 'Outstanding'];

// One filter chip's test; stance chips match the stance, the last two match what the records say.
const matches = (c: Company, f: string) => f === 'All' ? Boolean(c.stance) || Boolean(activeApplication(c))
    : f === 'Active application' ? Boolean(activeApplication(c))
        : f === 'Outstanding' ? isOutstanding(c) && c.stance !== 'Ruled out'
        : f === 'Not placed' ? !c.stance : c.stance === f;

export function CompaniesPage() {
    const { data, isPending, isError } = useCompanies();
    const postings = usePostings().data ?? [];
    const [params, setParams] = useSearchParams();
    const act = useAct();
    const [adding, setAdding] = useState(false);
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load. Reload to try again.</p>;

    const all = data ?? [];
    const filter = params.get('status') ?? 'All';
    const rows = all.filter((c) => matches(c, filter));
    const pick = (s: string) => setParams(s === 'All' ? {} : { status: s }, { replace: true });

    return (
        <>
            <div className="chips">
                {['All', ...STATUSES].map((s) => (
                    <Chip key={s} on={filter === s} onClick={() => pick(s)}>{s}<span className="n">{all.filter((c) => matches(c, s)).length}</span></Chip>
                ))}
                <span className="chips-gap" />
                <Button type="button" aria-expanded={adding} onClick={() => setAdding((x) => !x)} title="Track a company by name. It starts at Watching and a model fills in its facts.">Add company</Button>
            </div>
            {adding && (
                <InlineForm title="Add a company" onClose={() => setAdding(false)} fields={[{ name: 'company', label: 'Company name', required: true }, { name: 'careersUrl', label: 'Careers page (optional)', type: 'url' }, { name: 'jobsUrl', label: 'Jobs board (optional)', type: 'url' }]}
                    submit={(v) => act({ type: 'addCompany', company: v.company, careersUrl: v.careersUrl, jobsUrl: v.jobsUrl }, `Added ${v.company} to Watching. Looking up its facts takes about 2 minutes.`)} />
            )}
            {rows.length === 0 ? <p className="empty">No companies with this status.</p> : (
                <div className="table-box">
                    <table className="list">
                        <thead><tr><th scope="col">Company</th><th scope="col">Stance</th><th scope="col">What they do</th><th scope="col">Postings</th><th scope="col">Last checked</th></tr></thead>
                        <tbody>
                            {rows.map((c) => (
                                <LinkRow key={c.key} to={`/companies/${c.key}`}>
                                    <td><CompanyLink company={c}><strong>{c.name}</strong></CompanyLink></td>
                                    <td className="small nowrap">{c.stance || 'Not placed'}</td>
                                    <td className="small clamp1 clamp1-cell"><RichText text={c.domain} /></td>
                                    <td className="num">{postings.filter((p) => p.companyKey === c.key).length || ''}</td>
                                    <td className="nowrap small num muted">{c.lastChecked}</td>
                                </LinkRow>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
