import { useAct, useTune, type TuneProposal } from '../data';
import { ActionButton } from '../toast';
import { Fold } from './ui';
import { RichText } from '../text';

// One proposed edit to the search rules: what changes, why, and Apply or Dismiss.
function Proposal({ p }: { p: TuneProposal }) {
    const act = useAct();
    return (
        <li className="tune-item">
            <p className="small"><strong>{p.file}</strong> · <RichText text={p.why} /></p>
            <div className="tune-diff">
                <pre className="tune-old" aria-label="Now">{p.find}</pre>
                <pre className="tune-new" aria-label="Proposed">{p.replace || '(removed)'}</pre>
            </div>
            {p.status === 'stale' && <p className="small error">{p.error ?? 'The file changed since this was proposed.'}</p>}
            <div className="actions">
                {p.status === 'open' && <ActionButton className="primary" title="Commit this edit to the search rules." action={() => act({ type: 'applyTune', id: p.id }, 'Applying. It lands in a minute or two.')}>Apply</ActionButton>}
                {p.status === 'applying' && <span className="muted small">Applying…</span>}
                {p.status !== 'applying' && <ActionButton title="Leave the rules as they are." action={() => act({ type: 'dismissTune', id: p.id }, 'Dismissed.')}>Dismiss</ActionButton>}
            </div>
        </li>
    );
}

// New: rule changes from the weekly tune run, from your Skip and Save reasons. Nothing changes until you apply one.
export function TuneBox() {
    const { data = [] } = useTune();
    if (!data.length) return null;
    return (
        <Fold className="group" defaultOpen heading="h2" label="Search rule changes" title={<>Search rule changes<span className="n">{data.length}</span></>}>
            <p className="small muted group-why">The weekly tune read your Skip and Save reasons and suggests these edits. Nothing changes until you apply one.</p>
            <ul className="plain">{data.map((p) => <Proposal key={p.id} p={p} />)}</ul>
        </Fold>
    );
}
