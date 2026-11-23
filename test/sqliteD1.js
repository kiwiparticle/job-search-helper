import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// A local stand-in for the D1 binding, backed by node:sqlite. Tests only.
export function sqliteD1(path = ':memory:') {
    const raw = new DatabaseSync(path);
    const stmt = (sql, params = []) => ({
        sql,
        params,
        bind: (...values) => stmt(sql, values),
        all: async () => ({ results: raw.prepare(sql).all(...params) }),
        first: async () => raw.prepare(sql).get(...params) ?? null,
        run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }),
    });
    return {
        prepare: (sql) => stmt(sql),
        exec: async (sql) => { raw.exec(sql); },
        async batch(statements) {
            raw.exec('BEGIN');
            try {
                const out = [];
                for (const s of statements) {
                    const p = raw.prepare(s.sql);
                    const rows = p.columns().length ? p.all(...s.params) : null;
                    const changes = rows ? 0 : Number(p.run(...s.params).changes);
                    out.push({ results: rows ?? [], meta: { changes } });
                }
                raw.exec('COMMIT');
                return out;
            } catch (e) {
                raw.exec('ROLLBACK');
                throw e;
            }
        },
    };
}

export async function applySchema(db) {
    await db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
}
