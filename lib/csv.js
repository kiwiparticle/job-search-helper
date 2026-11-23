export function parseCsv(text) {
    const records = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some((c) => c !== '')) records.push(row);
            row = [];
        } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c !== '')) records.push(row);
    if (!records.length) return [];
    const [header, ...body] = records;
    const keys = header.map((h) => h.trim().toLowerCase());
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()]).filter(([, v]) => v !== '')));
}
