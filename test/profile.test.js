import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanProfile, loadProfile, profileSlots } from '../lib/profile.js';

const fill = new URL('../bin/fill-prompt.js', import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), 'p-'));

test('profileSlots formats a USD floor', () => {
    const s = profileSlots(cleanProfile({ payFloor: 170000, currency: 'USD', who: 'x' }));
    assert.equal(s.PROFILE_PAY_FLOOR, '$170,000');
    assert.equal(s.PROFILE_WHO, 'x');
    assert.equal(s.PROFILE_STACK, '');
});
test('profileSlots names another currency', () => {
    assert.equal(profileSlots(cleanProfile({ payFloor: 90000, currency: 'EUR' })).PROFILE_PAY_FLOOR, '90,000 EUR');
});
test('levelsOut is a slot', () => {
    assert.equal(profileSlots(cleanProfile({ levelsOut: 'intern' })).PROFILE_LEVELS_OUT, 'intern');
    assert.equal(profileSlots(cleanProfile({})).PROFILE_LEVELS_OUT, '');
});
test('no floor reads as no floor', () => {
    assert.equal(profileSlots(cleanProfile({})).PROFILE_PAY_FLOOR, 'none');
    assert.equal(cleanProfile({ payFloor: -5 }).payFloor, null);
    assert.equal(cleanProfile({}).currency, 'USD');
});
test('loadProfile throws naming the file when missing', () => {
    assert.throws(() => loadProfile(tmp()), /data\/profile\.json.*examples/);
});
test('fill-prompt fails closed without a profile', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'p.md'), 'hi {{PROFILE_WHO}}');
    const r = spawnSync('node', [fill, join(dir, 'p.md')], { env: { ...process.env, REPO: dir }, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /data\/profile\.json/);
    assert.equal(r.stdout, '');
});
test('fill-prompt fills env and profile slots, env wins', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data/profile.json'), JSON.stringify({ who: 'Ann', stack: 'Rust' }));
    writeFileSync(join(dir, 'p.md'), '{{OUT}} {{PROFILE_WHO}} {{PROFILE_STACK}} {{NOPE}}|');
    const r = spawnSync('node', [fill, join(dir, 'p.md')], { env: { ...process.env, REPO: dir, OUT: '/o', PROFILE_STACK: 'env' }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '/o Ann env |');
});

test('PROFILE_TIE_BREAK is the owner line when set, else tied to the floor', () => {
    assert.equal(profileSlots(cleanProfile({ tieBreak: 'Own line.' })).PROFILE_TIE_BREAK, 'Own line.');
    assert.match(profileSlots(cleanProfile({ payFloor: 170000 })).PROFILE_TIE_BREAK, /well above \$170,000 rounds it up/);
});
