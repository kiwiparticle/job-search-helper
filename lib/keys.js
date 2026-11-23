const SUFFIXES = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'software', 'technologies', 'technology', 'health']);

const norm = (s) => {
    const words = String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    while (words.length > 1 && SUFFIXES.has(words.at(-1))) words.pop();
    return words.join('');
};

// Parenthetical notes like "(Holdco subsidiary)" are commentary, not part of the name.
const aliases = (name) => String(name ?? '').replace(/\([^)]*\)/g, ' ').split(' / ').map(norm).filter(Boolean);

export const companyKey = (name) => aliases(name)[0] ?? '';

export const sameCompany = (a, b) => {
    const bs = new Set(aliases(b));
    return aliases(a).some((k) => bs.has(k));
};

export const leadKey = (company, role) => `${companyKey(company)}::${String(role ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
