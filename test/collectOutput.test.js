import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, lstatSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../bin/collect-output.sh', import.meta.url).pathname;

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'collect-'));
    const src = join(root, 'src'), dest = join(root, 'dest');
    mkdirSync(src);
    return { root, src, dest };
}
const run = (src, dest, ...names) => spawnSync('/bin/bash', [script, src, dest, ...names], { encoding: 'utf8' });

test('copies a named file, skips an unnamed one, ignores an absent one', () => {
    const { src, dest } = setup();
    writeFileSync(join(src, 'answer.md'), 'hi');
    writeFileSync(join(src, 'other.txt'), 'no');
    const r = run(src, dest, 'answer.md', 'status.txt');
    assert.equal(r.status, 0);
    assert.equal(readFileSync(join(dest, 'answer.md'), 'utf8'), 'hi');
    assert.equal(existsSync(join(dest, 'other.txt')), false);
    assert.equal(existsSync(join(dest, 'status.txt')), false);
});

test('refuses a symlink', () => {
    const { src, dest } = setup();
    symlinkSync('/etc/passwd', join(src, 'answer.md'));
    const r = run(src, dest, 'answer.md');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(dest, 'answer.md')), false);
});

test('refuses a 3 MB file', () => {
    const { src, dest } = setup();
    writeFileSync(join(src, 'answer.md'), Buffer.alloc(3 * 1024 * 1024, 'a'));
    assert.notEqual(run(src, dest, 'answer.md').status, 0);
    assert.equal(existsSync(join(dest, 'answer.md')), false);
});

test('refuses names with a slash or ..', () => {
    const { root, src, dest } = setup();
    writeFileSync(join(root, 'x'), 'secret');
    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'sub', 'y'), 'y');
    assert.notEqual(run(src, dest, '../x').status, 0);
    assert.notEqual(run(src, dest, 'sub/y').status, 0);
    assert.equal(existsSync(join(dest, 'x')), false);
    assert.equal(existsSync(join(dest, 'y')), false);
});

test('runs under env -i with a fixed PATH', () => {
    const { src, dest } = setup();
    writeFileSync(join(src, 'a.md'), 'a');
    execFileSync('env', ['-i', '/bin/bash', script, src, dest, 'a.md']);
    assert.equal(existsSync(join(dest, 'a.md')), true);
});

test('refuses a hard link', () => {
    const { root, src, dest } = setup();
    writeFileSync(join(root, 'secret'), 'secret');
    linkSync(join(root, 'secret'), join(src, 'answer.md'));
    assert.notEqual(run(src, dest, 'answer.md').status, 0);
    assert.equal(existsSync(join(dest, 'answer.md')), false);
});

test('does not write through a symlink already at the destination', () => {
    const { root, src, dest } = setup();
    writeFileSync(join(root, 'victim'), 'untouched');
    mkdirSync(dest);
    symlinkSync(join(root, 'victim'), join(dest, 'answer.md'));
    writeFileSync(join(src, 'answer.md'), 'new');
    assert.equal(run(src, dest, 'answer.md').status, 0);
    assert.equal(readFileSync(join(root, 'victim'), 'utf8'), 'untouched');
    assert.equal(lstatSync(join(dest, 'answer.md')).isSymbolicLink(), false);
    assert.equal(readFileSync(join(dest, 'answer.md'), 'utf8'), 'new');
});

test('clears stale files in the destination', () => {
    const { src, dest } = setup();
    mkdirSync(dest);
    writeFileSync(join(dest, 'context.json'), 'forged');
    writeFileSync(join(src, 'a.md'), 'a');
    run(src, dest, 'a.md');
    assert.equal(existsSync(join(dest, 'context.json')), false);
});
