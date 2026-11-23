import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { crc32 } from 'node:zlib';

const script = new URL('../bin/privacy-check.js', import.meta.url).pathname;

// A stored (uncompressed) zip: enough for unzip to list and read each part.
function zip(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const n = Buffer.from(name);
        const d = Buffer.from(text);
        const crc = crc32(d);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14); local.writeUInt32LE(d.length, 18); local.writeUInt32LE(d.length, 22);
        local.writeUInt16LE(n.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(d.length, 20); central.writeUInt32LE(d.length, 24);
        central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
        locals.push(local, n, d);
        centrals.push(central, n);
        offset += 30 + n.length + d.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

function run(files) {
    const root = mkdtempSync(join(tmpdir(), 'privacy-'));
    const data = join(root, 'data');
    const tree = join(root, 'tree');
    mkdirSync(data);
    mkdirSync(tree);
    writeFileSync(join(data, 'privacy-terms.txt'), '# owner\nJane Q Owner\nZZ\n');
    for (const [name, body] of Object.entries(files)) writeFileSync(join(tree, name), body);
    return spawnSync('node', [script, tree], { encoding: 'utf8', env: { ...process.env, PRIVACY_DATA: data } });
}

const parts = (core, extra = {}) => zip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document><w:p><w:t>Hello</w:t></w:p></w:document>',
    'docProps/core.xml': core,
    ...extra,
});

test('a term in a docx core.xml is flagged', () => {
    const r = run({ 't.docx': parts('<cp:coreProperties><cp:lastModifiedBy>Owner, Jane Q</cp:lastModifiedBy><dc:creator>Jane Q Owner</dc:creator></cp:coreProperties>') });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /t\.docx!docProps\/core\.xml:1: Jane Q Owner/);
});

test('a sensitivity label GUID and siteId are flagged', () => {
    const r = run({ 't.docx': parts('<x/>', { 'docMetadata/LabelInfo.xml': '<clbl:label siteId="{12345678-abcd-4bcd-8bcd-1234567890ab}"/>' }) });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /GUID in docMetadata/);
    assert.match(r.stdout, /siteId/);
});

test('short uppercase terms match case-sensitively; a clean tree exits 0', () => {
    assert.equal(run({ 'a.txt': 'zz top, fuzz, buzz\n', 't.docx': parts('<x/>') }).status, 0);
    const r = run({ 'a.txt': 'lives in ZZ\n' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /a\.txt:1: ZZ/);
});

test('a term in an unpushed commit message is flagged', () => {
    const root = mkdtempSync(join(tmpdir(), 'privacy-git-'));
    const data = join(root, 'data');
    const tree = join(root, 'tree');
    mkdirSync(data);
    mkdirSync(tree);
    writeFileSync(join(data, 'privacy-terms.txt'), 'Jane Q Owner\n');
    writeFileSync(join(tree, 'a.txt'), 'clean\n');
    const git = (...a) => spawnSync('git', ['-C', tree, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'Fix\n\nAsked by Jane Q Owner');
    const r = spawnSync('node', [script, tree], { encoding: 'utf8', env: { ...process.env, PRIVACY_DATA: data } });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^commit [0-9a-f]{12}:3: Jane Q Owner$/m);
});
