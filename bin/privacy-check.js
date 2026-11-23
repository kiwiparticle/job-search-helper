#!/usr/bin/env node
// Owner-data check for the engine tree: node bin/privacy-check.js <dir>
// Terms: data/privacy-terms.txt, plus names of companies in data/companies.jsonl with an
// application or a job state. Whole words, case-insensitive; a term that is all uppercase
// and at most 3 characters (a state code) matches case-sensitively. data/privacy-allow.txt lists
// false positives: `term` ignores it everywhere, `path: term` only in that file.
// Lines starting with # are comments in both files. Exit 1 lists `file:line: term`.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// PRIVACY_DATA overrides the folder holding the three owner files (tests use it).
const data = process.env.PRIVACY_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
// --all-companies checks every company name, not only ones with an application or job state.
const all = process.argv.includes('--all-companies');
const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!dir || !existsSync(dir)) {
    console.error('usage: node bin/privacy-check.js [--all-companies] <dir>');
    process.exit(2);
}

const lines = (file) => existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];

const terms = new Set(lines(join(data, 'privacy-terms.txt')));
for (const line of lines(join(data, 'companies.jsonl'))) {
    const row = JSON.parse(line);
    if (all || (row.applications || []).length || Object.keys(row.jobs || {}).length) terms.add(row.name.trim());
}
const allowAll = new Set();
const allowIn = new Set();
for (const line of lines(join(data, 'privacy-allow.txt'))) {
    const m = line.match(/^(\S+):\s+(.+)$/);
    if (m) allowIn.add(`${m[1]}\0${m[2].toLowerCase()}`);
    else allowAll.add(line.toLowerCase());
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (t) => t.length <= 3 && /[A-Z]/.test(t) && t === t.toUpperCase();
const pattern = (list) => `(?<![\\p{L}\\p{N}_])(${list.map(escape).join('|')})(?![\\p{L}\\p{N}_])`;
const sorted = [...terms].filter((t) => !allowAll.has(t.toLowerCase())).sort((a, b) => b.length - a.length);
const regexes = [[sorted.filter((t) => !exact(t)), 'giu'], [sorted.filter(exact), 'gu']]
    .filter(([list]) => list.length).map(([list, flags]) => new RegExp(pattern(list), flags));

const hits = [];
function scan(name, text) {
    text.split('\n').forEach((line, i) => {
        for (const re of regexes) {
            for (const m of line.matchAll(re)) {
                if (!allowIn.has(`${name}\0${m[1].toLowerCase()}`)) hits.push(`${name}:${i + 1}: ${m[1]}`);
            }
        }
    });
}

// Every XML part of a .docx: text with tags stripped, plus attribute values (metadata lives there too).
// Any GUID in docMetadata/ (sensitivity labels) or a siteId attribute is a tenant id: always a hit.
function scanDocx(name, path) {
    const unzip = (...a) => execFileSync('unzip', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const part of unzip('-Z1', path).split('\n').filter((p) => /\.(xml|rels)$/.test(p))) {
        const xml = unzip('-p', path, part.replace(/[[\]*?\\]/g, '\\$&'));
        const where = `${name}!${part}`;
        if (part.startsWith('docMetadata/') && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(xml)) hits.push(`${where}:0: GUID in docMetadata`);
        if (/\bsiteId\s*=/i.test(xml)) hits.push(`${where}:0: siteId`);
        const attrs = [...xml.matchAll(/="([^"]*)"/g)].map((m) => m[1]).join('\n');
        scan(where, `${xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ')}\n${attrs}`);
    }
}

function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const path = join(d, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.isFile()) continue;
        const name = relative(dir, path);
        if (name.endsWith('.docx')) { scanDocx(name, path); continue; }
        const buf = readFileSync(path);
        if (buf.includes(0)) {
            hits.push(`${name}:0: binary file not checked`);
            continue;
        }
        scan(name, buf.toString('utf8'));
    }
}

walk(dir);
if (existsSync(join(dir, '.git'))) {
    const log = execFileSync('git', ['-C', dir, 'log', '--format=%an %ae'], { encoding: 'utf8' });
    scan('git log', log);
    // Messages of commits not yet pushed (all commits when there is no upstream).
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    let range = [];
    try { git('rev-parse', '--abbrev-ref', '@{u}'); range = ['@{u}..HEAD']; } catch { /* no upstream */ }
    let shas = [];
    try { shas = git('rev-list', ...(range.length ? range : ['HEAD'])).split('\n').filter(Boolean); } catch { /* no commits */ }
    for (const sha of shas) scan(`commit ${sha.slice(0, 12)}`, git('log', '-1', '--format=%B', sha));
}

if (hits.length) {
    console.log(hits.join('\n'));
    console.error(`privacy check: ${hits.length} hit(s) in ${dir}`);
    process.exit(1);
}
console.log(`privacy check: clean (${terms.size} terms)`);
