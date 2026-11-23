// Reads and merges the review.json files a review pass produced. Model output is untrusted: capped and checked here.
const STATES = new Set(['used', 'missing', 'not-in-master']);
// When two reviewers disagree on a term, the less comfortable answer wins.
const RANK = { used: 0, missing: 1, 'not-in-master': 2 };

export function readReview(text) {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    if (!j || typeof j !== 'object') return null;
    const keywords = (Array.isArray(j.keywords) ? j.keywords : [])
        .filter((k) => k && typeof k.term === 'string' && k.term.trim() && STATES.has(k.state))
        .slice(0, 60).map((k) => ({ term: k.term.trim().slice(0, 80), state: k.state }));
    const truth = (Array.isArray(j.truth) ? j.truth : [])
        .filter((t) => typeof t === 'string' && t.trim()).slice(0, 20).map((t) => t.trim().slice(0, 300));
    const questions = (Array.isArray(j.questions) ? j.questions : [])
        .filter((q) => q && typeof q.question === 'string' && q.question.trim())
        .slice(0, 5).map((q) => ({ question: q.question.trim().slice(0, 400), why: typeof q.why === 'string' ? q.why.trim().slice(0, 300) : '' }));
    return { keywords, truth, questions };
}

// reviews: [{ model, keywords, truth }]. Keywords and truth are replaced: they describe the draft as it is now.
// `reviews` on the kit records who looked and when, one entry per model (a new one replaces that model's old one).
export function mergeReviews(kit, reviews, at) {
    const byTerm = new Map();
    for (const r of reviews) {
        for (const k of r.keywords) {
            const key = k.term.toLowerCase();
            const had = byTerm.get(key);
            if (!had || RANK[k.state] > RANK[had.state]) byTerm.set(key, k);
        }
    }
    const models = new Set(reviews.map((r) => r.model));
    return {
        ...kit,
        keywords: [...byTerm.values()],
        truth: [...new Set(reviews.flatMap((r) => r.truth))],
        // Two reviewers often ask the same thing: keep one of each.
        questions: [...new Map(reviews.flatMap((r) => r.questions ?? []).map((q) => [q.question.toLowerCase(), q])).values()].slice(0, 8),
        reviews: [...(kit.reviews ?? []).filter((r) => !models.has(r.model)), ...reviews.map((r) => ({ model: r.model, at }))],
    };
}
