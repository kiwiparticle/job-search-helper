import { useAct } from '../data';
import type { Company, Proposal } from '../model';
import { useModels } from '../models';
import { ActionButton } from '../toast';
import { FieldTable } from './FieldTable';
import { RichText } from '../text';

// One proposal from an Ask answer: what it would change, with Apply and Dismiss.
export function ProposalBox({ company, proposal }: { company: Company; proposal: Proposal }) {
    const act = useAct();
    const { label } = useModels();
    const decide = (type: 'applyProposal' | 'dismissProposal', done: string) => () => act({ type, company: company.name, id: proposal.id }, done);
    return (
        <section className="proposal" aria-label="Proposed change from a question">
            <h3>{label(proposal.by)} proposes a change</h3>
            {proposal.text && <p className="small"><RichText text={proposal.text} /></p>}
            <FieldTable company={company} base={proposal.base} columns={[[label(proposal.by), proposal.changes]]} />
            <div className="actions">
                <ActionButton title="Apply this suggested change to the company." className="primary" action={decide('applyProposal', 'Applied.')}>Apply</ActionButton>
                <ActionButton title="Discard this suggestion. Nothing changes." action={decide('dismissProposal', 'Dismissed.')}>Dismiss</ActionButton>
            </div>
        </section>
    );
}
