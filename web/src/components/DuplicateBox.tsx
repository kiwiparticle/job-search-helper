import { useAct, useCompanies } from '../data';
import type { Company } from '../model';
import { ActionButton } from '../toast';

export function DuplicateBox({ company }: { company: Company }) {
    const act = useAct();
    const { data } = useCompanies();
    if (!company.possibleDuplicateOf) return null;
    const other = data?.find((c) => c.key === company.possibleDuplicateOf);
    const otherName = other?.name ?? company.possibleDuplicateOf;
    return (
        <section className="proposal" aria-label="Possible duplicate">
            <h3>This might be the same company as {otherName}</h3>
            <div className="actions">
                <ActionButton title="Combine the two records into one company." className="primary" action={() => act({ type: 'mergeCompany', from: company.name, into: otherName }, `Merged into ${otherName}.`)}>Same company — merge</ActionButton>
                <ActionButton title="Keep them as two separate companies and stop asking." action={() => act({ type: 'keepSeparate', company: company.name, other: company.possibleDuplicateOf }, 'Kept as separate companies.')}>Different companies</ActionButton>
            </div>
        </section>
    );
}
