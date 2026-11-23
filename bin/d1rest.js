// A D1-shaped db over Cloudflare's REST API: POST .../d1/database/<id>/query with {sql, params} or {batch: [...]}.
export function fromEnv(env = process.env) {
    const names = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];
    const missing = names.filter((n) => !env[n]);
    if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`);
    return d1rest({ accountId: env.CLOUDFLARE_ACCOUNT_ID, databaseId: env.D1_DATABASE_ID, token: env.CLOUDFLARE_API_TOKEN });
}

export function d1rest({ accountId, databaseId, token, fetchImpl = fetch }) {
    const call = async (body) => {
        let res, json;
        // 429 means D1 refused before running anything, so retrying a write is safe.
        // ponytail: 5 tries, 2s/4s/8s/16s waits; raise if load limits last longer.
        for (let attempt = 0; ; attempt++) {
            res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            json = await res.json().catch(() => ({}));
            if (res.status !== 429 || attempt >= 4) break;
            await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        }
        if (!res.ok || !json.success) {
            throw Object.assign(new Error(`D1 ${res.status}: ${json.errors?.map((e) => e.message).join('; ') || 'request failed'}`), { status: res.status, code: json.errors?.[0]?.code });
        }
        return json.result;
    };
    const stmt = (sql, params = []) => ({
        sql,
        params,
        bind: (...values) => stmt(sql, values),
        all: async () => ({ results: (await call({ sql, params }))[0].results }),
        first: async () => (await call({ sql, params }))[0].results[0] ?? null,
        run: async () => ({ meta: { changes: (await call({ sql, params }))[0].meta.changes } }),
    });
    return {
        prepare: (sql) => stmt(sql),
        exec: async (sql) => { await call({ sql }); },
        batch: (statements) => call({ batch: statements.map((s) => ({ sql: s.sql, params: s.params })) }),
    };
}
