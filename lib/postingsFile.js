export const parsePostings = (text) => String(text)
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line)
    .map(({ line, n }) => {
        try {
            const v = JSON.parse(line);
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
            return v;
        } catch (e) {
            throw new Error(`postings.jsonl line ${n}: ${e.message}`);
        }
    });

export const renderPostings = (list) => [...list]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(({ id, ...rest }) => `${JSON.stringify({ id, ...rest })}\n`)
    .join('');

export const blankPosting = ({ id, companyKey, leadKey, role, url, source }) => ({
    id, companyKey, leadKey, role, url,
    pay: '',
    modelSays: 'pass',
    wasLead: false,
    verdicts: {},
    firstRun: '',
    lastRun: '',
    posted: 'unknown',
    postedCheckedAt: '',
    source,
});
