import type { Company } from '../model';

const LABELS: Record<string, string> = {
    stance: 'Status', verdict: 'Verdict', domain: 'Domain', reason: 'Why', recheckTrigger: 'Next check',
    rolesSkipped: 'Roles skipped', awards: 'Awards', fingerprint: 'Fingerprint',
    website: 'Website', careersUrl: 'Careers page', jobsUrl: 'Jobs board', size: 'Size', founded: 'Founded', funding: 'Funding', stability: 'Stability', culture: 'Culture', facts: 'Facts',
};
const show = (v: unknown) => (Array.isArray(v) ? v.join('; ') : String(v ?? ''));

// Every field a model proposed to change, known ones first in the table's order; an unknown field shows under its own name.
const proposedFields = (columns: [string, Record<string, unknown>][], base?: Record<string, unknown>) => {
    const order = Object.keys(LABELS);
    const rank = (f: string) => (order.includes(f) ? order.indexOf(f) : order.length);
    return [...new Set(columns.flatMap(([, c]) => Object.keys(c)))]
        .filter((f) => columns.some(([, c]) => f in c && show(c[f]) !== show(base?.[f])))
        .sort((x, y) => rank(x) - rank(y));
};

// Fields (other than the add-only rolesSkipped) whose current value is no longer what the models saw.
export const movedFields = (company: Company, base: Record<string, unknown> | undefined, fields: string[]) =>
    fields.filter((f) => f !== 'rolesSkipped' && show(company[f as keyof Company]) !== show(base?.[f]));

// One row per field: the current value, then what each proposer wants.
export function FieldTable({ company, base, columns }: { company: Company; base?: Record<string, unknown>; columns: [string, Record<string, unknown>][] }) {
    const fields = proposedFields(columns, base);
    const moved = movedFields(company, base, fields);
    return (
        <div className="table-box">
            <table className="list" aria-label="Proposed changes">
                <thead><tr><th scope="col">Field</th><th scope="col">Now</th>{columns.map(([name]) => <th key={name} scope="col">{name}</th>)}</tr></thead>
                <tbody>
                    {fields.map((f) => (
                        <tr key={f}>
                            <th scope="row">{LABELS[f] ?? f}</th>
                            <td>{show(company[f as keyof Company]) || <span className="muted">empty</span>}{moved.includes(f) && <><br /><span className="tag">changed since the run</span></>}</td>
                            {columns.map(([name, c]) => <td key={name}>{f in c ? show(c[f]) : <span className="muted">no change</span>}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
