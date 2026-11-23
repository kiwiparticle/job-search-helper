import { CompanyLink } from './CompanyLink';
import { Link, useSearchParams } from 'react-router';
import { useFloor, useJobs, useKits } from '../data';
import { belowFloor, payNumber, rowStamp, shortPay } from '../format';
import { PostingLink } from '../text';
import { Chip, JobTags, LinkRow, PostedNote } from './Tags';

const FILTERS = [['all', 'All'], ['saved', 'Saved'], ['unsaved', 'Not saved']] as const;

const isSaved = (entry?: { state: string }) => entry?.state === 'saved' || entry?.state === 'applying';

export function JobsPage() {
    const { rows: open, isPending, isError } = useJobs();
    const floor = useFloor();
    const { data: kits = [] } = useKits();
    const [params, setParams] = useSearchParams();
    const filter = FILTERS.find(([id]) => id === params.get('show'))?.[0] ?? 'all';
    const sort = params.get('sort') === 'new' ? 'new' : 'pay';
    const set = (name: string, value: string | null) => setParams((p) => { if (value) p.set(name, value); else p.delete(name); return p; }, { replace: true });

    if (isPending) return <p className="empty">Loading…</p>;
    if (isError) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;

    const shown = open
        .filter(({ entry }) => filter === 'all' || (filter === 'saved') === isSaved(entry))
        .sort((a, b) => sort === 'pay'
            ? payNumber(b.posting.pay) - payNumber(a.posting.pay)
            : b.posting.firstRun.localeCompare(a.posting.firstRun));

    return (
        <>
            <div className="chips">
                {FILTERS.map(([id, label]) => <Chip key={id} on={filter === id} onClick={() => set('show', id === 'all' ? null : id)}>{label}<span className="n">{open.filter(({ entry }) => id === 'all' || (id === 'saved') === isSaved(entry)).length}</span></Chip>)}
                <span className="chips-gap" />
                <Chip on={sort === 'pay'} onClick={() => set('sort', null)}>Highest pay</Chip>
                <Chip on={sort === 'new'} onClick={() => set('sort', 'new')}>Newest</Chip>
            </div>
            {open.length === 0 ? <p className="empty">No open jobs yet. They appear after a search run finds a lead.</p>
                : shown.length === 0 ? <p className="empty">No jobs match this filter.</p> : (
                    <div className="table-box">
                        <table className="list">
                            <thead><tr><th scope="col">Job</th><th scope="col">Pay</th><th scope="col">Status</th><th scope="col">Added</th></tr></thead>
                            <tbody>
                                {shown.map(({ company, posting: p }) => (
                                    <LinkRow key={p.id} to={`/jobs/${p.id}`}>
                                        <td className="job-cell"><Link to={`/jobs/${p.id}`}><strong>{p.role}</strong></Link> <PostingLink url={p.url} /><div className="co muted"><CompanyLink company={company} /><PostedNote posting={p} /></div></td>
                                        <td className={belowFloor(p, floor) ? 'small nowrap low' : 'small nowrap'}>{shortPay(p)}</td>
                                        <td className="small"><JobTags company={company} posting={p} kits={kits} /></td>
                                        <td className="small nowrap muted">{rowStamp(p.firstRun)}</td>
                                    </LinkRow>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
        </>
    );
}
