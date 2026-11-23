// Pure: data/models.json text in the file's layout (one entry per line, objects and arrays inline).
const inline = (v) => Array.isArray(v) ? `[${v.map(inline).join(', ')}]`
    : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }`
        : JSON.stringify(v);

export const registryText = (r) =>
    `{\n  "models": [\n${r.models.map((m) => `    ${inline(m)}`).join(',\n')}\n  ],\n  "defaults": {\n${Object.entries(r.defaults ?? {}).map(([k, v]) => `    ${JSON.stringify(k)}: ${inline(v)}`).join(',\n')}\n  }\n}\n`;

// `enabled` is { id: boolean }. Only ids already in the registry change; turning one on clears nothing else.
export function setEnabled(registry, enabled) {
    const models = registry.models.map((m) => (Object.hasOwn(enabled, m.id) ? { ...m, enabled: enabled[m.id] === true } : m));
    return { ...registry, models };
}
