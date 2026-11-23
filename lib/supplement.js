// Facts the owner supplied outside master-resume.md (answers to a model's questions, or added by hand).
// They count as true for every kit until the owner merges one into the master or dismisses it. Browser-safe.
export const SUPPLEMENT_CAPS = { text: 1500, question: 400 };

export const STATUSES = ['open', 'merging', 'merged', 'dismissed'];

export function newEntry({ id, text, question, kit, at }) {
    const clip = (v, n) => String(v ?? '').trim().slice(0, n);
    return { id, text: clip(text, SUPPLEMENT_CAPS.text), ...(question && { question: clip(question, SUPPLEMENT_CAPS.question) }), ...(kit && { kit: clip(kit, 200) }), at, status: 'open' };
}

// Facts a kit run may use: everything not yet in the master and not dismissed.
export const inUse = (entries) => entries.filter((e) => e.status === 'open' || e.status === 'merging');

// One line per fact for the model prompt, cut to `budget` characters (oldest first stay).
export function factsBlock(entries, budget = 20000) {
    const lines = inUse(entries).sort((a, b) => a.at.localeCompare(b.at))
        .map((e) => `- ${e.question ? `Asked: "${e.question}" The owner answered: ` : ''}${e.text.replace(/\s+/g, ' ')}`);
    let out = '';
    for (const l of lines) {
        if (out.length + l.length + 1 > budget) break;
        out += `${l}\n`;
    }
    return out.trimEnd();
}
