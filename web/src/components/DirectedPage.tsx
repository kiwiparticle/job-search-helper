import { useState } from 'react';
import { Link } from 'react-router';
import { DIRECTED_SEARCH } from '../actions';
import { useAct, useActiveRuns, useCompanies, useReport, useRuns } from '../data';
import type { RunSummary } from '../model';
import { LeadsTable, SearcherFailures } from './RunsPage';
import { OpenAction } from './OpenAction';
import { Button, Fold } from './ui';

const TITLE = 'directed ';

// One directed search's results. Mounted only while its fold is open, so closed ones load nothing.
function Results({ run }: { run: string }) {
    const { data: report, isPending, isError } = useReport(run);
    const { data: companies = [] } = useCompanies();
    if (isPending) return <p className="empty">Loading…</p>;
    if (isError || !report) return <p className="empty" role="alert">Couldn't load this. Reload to try again.</p>;
    return (
        <>
            <SearcherFailures report={report} />
            {report.leads.length ? <LeadsTable rows={report.leads} companies={companies} /> : <p className="empty">No leads from this search.</p>}
            <p className="small"><Link to={`/runs/${run}`}>Full report</Link>, with what it skipped ({report.nearMisses.length}) and what it changed ({report.changes.length})</p>
        </>
    );
}

const day = (r: RunSummary) => new Date(r.finishedAt ?? r.run.slice(0, 10)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Searches the owner directs in their own words. Every one stays listed here with its leads; they also go to New.
export function DirectedPage() {
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const act = useAct();
    const { data: runs = [], isPending } = useRuns();
    const running = useActiveRuns().filter((r) => r.title?.startsWith(TITLE));
    const done = runs.filter((r) => r.workflow === 'directed');
    const start = async () => {
        setSending(true);
        if (await act({ type: 'run', workflow: 'directed', topic: text.trim() }, DIRECTED_SEARCH.done({ company: '' }, {}, String))) setText('');
        setSending(false);
    };
    return (
        <>
            <div className="head"><h1>Directed searches</h1><p className="muted">Tell a search what to look for. Its leads also show in New.</p></div>
            <div className="directed-form">
                <label htmlFor="directed-text" className="sr-only">What to search for</label>
                <textarea
                    id="directed-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder="Staff frontend or graphics roles at CAD and 3D tool companies paying $250k or more"
                />
                <div className="row">
                    <Button type="button" className="primary" disabled={!text.trim() || sending} onClick={start}>Start search</Button>
                    <OpenAction def={DIRECTED_SEARCH} ctx={{ company: '', topic: text }} onDone={() => setText('')}>Start with other models…</OpenAction>
                </div>
            </div>
            {running.length > 0 && (
                <ul className="plain directed-running" role="status">
                    {running.map((r, i) => (
                        <li key={r.url ?? i}>
                            <span className="tag">{r.status === 'queued' ? 'Waiting for your PC' : 'Running'}</span> {r.title!.slice(TITLE.length)}
                        </li>
                    ))}
                </ul>
            )}
            {isPending ? <p className="empty">Loading…</p>
                : done.length === 0 ? <p className="empty">No directed searches yet. Type what you want above and start one.</p>
                    : (
                        <div className="directed-list">
                            {done.map((r, i) => (
                                <Fold
                                    key={r.run} heading="h3" defaultOpen={i === 0} className="directed-item"
                                    title={<span className="directed-topic">{r.topic || r.run}</span>}
                                    aside={<span className="muted small nowrap">{day(r)}, {r.counts?.leads ?? 0} {r.counts?.leads === 1 ? 'lead' : 'leads'}</span>}
                                >
                                    <Results run={r.run} />
                                </Fold>
                            ))}
                        </div>
                    )}
        </>
    );
}
