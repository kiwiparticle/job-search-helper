// The owner's notes: a dated list per company (`notes`) and per job (`jobNotes[postingId]`), oldest first.
// Old data holds one string (`note`, or a string in `jobNotes`); it reads as one undated entry. Browser-safe.
export function notesOf(c, postingId) {
    const v = postingId ? c.jobNotes?.[postingId] : (c.notes ?? c.note);
    return Array.isArray(v) ? v : typeof v === 'string' && v ? [{ at: '', text: v }] : [];
}
