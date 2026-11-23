import { REVIEW_JOB } from '../actions';
import { OpenAction } from './OpenAction';

// Short Review button for list rows. Opens the shared modal; writes nothing itself, so a skipped job stays skipped.
export function ReviewJobButton({ company, role, url }: { company: string; role: string; url?: string }) {
    if (!url) return null;
    return <OpenAction def={REVIEW_JOB} ctx={{ company, role, url }} busyText="Reviewing…">Review</OpenAction>;
}
