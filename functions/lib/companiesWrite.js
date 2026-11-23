import { loadSome, writeRows } from '../../lib/store.js';

const MOVED = 'Someone else changed the data at the same moment. Nothing was saved. Try again.';

// Load `keys`, let `edit(recordsByKey)` mutate them (add a key, set one to null to delete, or return null to skip),
// then write only the changed rows. A moved version gets one retry from a fresh load, then a 409.
export async function updateCompanies(db, keys, edit) {
    for (let attempt = 0; ; attempt++) {
        const rows = await loadSome(db, 'companies', keys);
        const recs = Object.fromEntries([...rows].map(([id, r]) => [id, structuredClone(r.record)]));
        if (edit(recs) === null) return;
        const companies = [];
        for (const [id, record] of Object.entries(recs)) {
            const old = rows.get(id);
            if (record == null) { if (old) companies.push({ id, version: old.version, record: null }); }
            else if (!old) companies.push({ id, version: null, record });
            else if (JSON.stringify(record) !== JSON.stringify(old.record)) companies.push({ id, version: old.version, record });
        }
        try {
            await writeRows(db, { companies });
            return;
        } catch (e) {
            if (!e.stale) throw e;
            if (attempt >= 1) throw Object.assign(new Error(MOVED), { status: 409 });
        }
    }
}
