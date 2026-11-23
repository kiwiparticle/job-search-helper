import { useState, type ReactNode } from 'react';
import { EACH, NONE, fitsBudget, reviewerOptions, resolveReviewer, searchDefaults, serverReviewer, useModels } from '../models';
import { Choice } from './ui';

const NO_SECOND = 'none';
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export type ModelPick = { searchers?: string[]; reviewer?: string };

// The first, second and reviewer pickers and their note. `pick` holds only what differs from the registry
// defaults, so leaving them untouched sends nothing extra.
export function useSearchModels(workflow?: string): { fields: ReactNode; pick: ModelPick } {
    const [pick, setPick] = useState<{ first?: string; second?: string; reviewer?: string }>({});
    const { models, defaults: all, label } = useModels();
    const defaults = { search: searchDefaults(all, workflow) };
    const first = pick.first ?? defaults.search.searchers[0];
    const second = pick.second ?? defaults.search.searchers[1] ?? NO_SECOND;
    const searchers = second === NO_SECOND ? [first] : [first, second];
    const sole = second === NO_SECOND ? first : null; // the one searcher, who may not also review
    const reviewer = resolveReviewer(pick.reviewer, defaults.search.reviewer, sole);

    const option = (m: (typeof models)[number], blocked?: boolean) => {
        const fit = fitsBudget(m, 'search');
        return { value: m.id, label: fit.ok ? m.label : `${m.label} (${fit.why})`, disabled: !fit.ok || blocked };
    };
    const used = [...new Set([...searchers, ...(reviewer === NONE || reviewer === EACH ? [] : [reviewer])])];
    const note = `Uses ${andList(used.map(label))}.${reviewer === NONE ? ' Nothing reviews the finds.' : ''}`;

    const pickOut: ModelPick = {
        ...(!same(searchers, defaults.search.searchers) && { searchers }),
        ...(reviewer !== serverReviewer(defaults.search.reviewer, sole) && { reviewer }),
    };
    const fields = (
        <>
            <label>First searcher
                <Choice label="First searcher" value={first} onChange={(v) => setPick({ ...pick, first: v })}
                    options={models.map((m) => option(m, m.id === second || (second === NO_SECOND && m.id === reviewer)))} />
            </label>
            <label>Second searcher
                <Choice label="Second searcher" value={second} onChange={(v) => setPick({ ...pick, second: v })}
                    options={[{ value: NO_SECOND, label: 'None', disabled: reviewer === first }, ...models.map((m) => option(m, m.id === first))]} />
            </label>
            <label>Reviewer
                <Choice label="Reviewer" value={reviewer} onChange={(v) => setPick({ ...pick, reviewer: v })}
                    options={[...reviewerOptions(sole), ...models.map((m) => option(m, m.id === sole))]} />
            </label>
            <p className="muted small" role="note">{note}</p>
        </>
    );
    return { fields, pick: pickOut };
}
