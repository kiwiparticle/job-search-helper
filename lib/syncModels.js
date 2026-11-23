// Pure: bind the owner's local llama configs to llama-local/ registry entries.
const PREFIX = 'llama-local/';
const ID = /^[a-z0-9][a-z0-9-]{0,29}$/;
// 'none' and 'each' are reviewer tokens in the route and dispatch.
const RESERVED = ['both', 'owner', 'review', 'incoming', 'none', 'each'];

function ctxOf(args) {
    if (!Array.isArray(args)) return undefined;
    const i = args.findIndex((a) => a === '--ctx-size' || a === '-c');
    const n = i >= 0 ? Number(args[i + 1]) : NaN;
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

function slug(alias) {
    return alias.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '');
}

function newId(alias, taken) {
    const base = slug(alias) || 'model';
    const ok = (id) => ID.test(id) && !RESERVED.includes(id) && !taken.has(id);
    if (ok(base)) return base;
    for (let n = 2; ; n++) {
        const suffix = `-${n}`;
        const id = base.slice(0, 30 - suffix.length).replace(/-$/, '') + suffix;
        if (ok(id)) return id;
    }
}

export function syncRegistry(registry, configs) {
    const changes = [];
    const models = registry.models.map((m) => ({ ...m }));
    const taken = new Set(models.map((m) => m.id));
    const aliases = Object.keys(configs);

    for (const m of models) {
        if (typeof m.model !== 'string' || !m.model.startsWith(PREFIX)) continue;
        const alias = m.model.slice(PREFIX.length);
        if (!aliases.includes(alias)) {
            if (m.enabled !== false || m.missing !== true) {
                m.enabled = false;
                m.missing = true;
                changes.push(`${m.id}: ${alias} is gone from the source; disabled and marked missing`);
            }
            continue;
        }
        if (m.missing) {
            delete m.missing;
            changes.push(`${m.id}: ${alias} is back in the source; missing cleared (still ${m.enabled === false ? 'disabled' : 'enabled'})`);
        }
        const ctx = ctxOf(configs[alias]?.args);
        if (ctx !== undefined && m.ctx !== ctx) {
            changes.push(`${m.id}: ctx ${m.ctx ?? 'unset'} -> ${ctx}`);
            m.ctx = ctx;
        }
    }

    const known = new Set(models.map((m) => m.model));
    for (const alias of aliases) {
        if (known.has(PREFIX + alias)) continue;
        const id = newId(alias, taken);
        taken.add(id);
        const ctx = ctxOf(configs[alias]?.args);
        models.push({ id, label: alias, runner: 'opencode', model: PREFIX + alias, ...(ctx !== undefined && { ctx }), enabled: false });
        const base = slug(alias);
        changes.push(`${id}: added ${alias}${ctx !== undefined ? ` (ctx ${ctx})` : ''}, disabled${id !== base ? ` (id ${base || 'model'} was unavailable)` : ''}`);
    }
    return { registry: { ...registry, models }, changes };
}
