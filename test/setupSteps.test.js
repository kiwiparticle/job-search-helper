import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { missingOwnerFiles, setD1Id, d1IdByName, d1Name, repoFromUrl, runnersWanted, runnerFolder } from '../lib/setupSteps.js';

test('missingOwnerFiles lists examples whose owner path is absent', () => {
    const d = mkdtempSync(join(tmpdir(), 's-'));
    mkdirSync(join(d, 'examples/data'), { recursive: true });
    writeFileSync(join(d, 'examples/a.md'), 'x');
    writeFileSync(join(d, 'a.md'), 'x');
    writeFileSync(join(d, 'examples/data/b.json'), '{}');
    assert.deepEqual(missingOwnerFiles(d), ['data/b.json']);
});
test('setD1Id replaces only the database_id line', () => {
    const t = 'name = "x"\ndatabase_name = "job-search"\ndatabase_id = "REPLACE_WITH_D1_ID"\n';
    assert.equal(setD1Id(t, 'abc-1'), 'name = "x"\ndatabase_name = "job-search"\ndatabase_id = "abc-1"\n');
});
test('d1IdByName picks by name, null when absent', () => {
    const j = JSON.stringify([{ uuid: 'u1', name: 'other' }, { uuid: 'u2', name: 'job-search' }]);
    assert.equal(d1IdByName(j, 'job-search'), 'u2');
    assert.equal(d1IdByName(j, 'nope'), null);
    assert.equal(d1IdByName('not json', 'x'), null);
});

import { hasPagesProject } from '../lib/setupSteps.js';
test('hasPagesProject matches the exact name only', () => {
    const row = (n, d = '') => ({ 'Project Name': n, 'Project Domains': d });
    assert.equal(hasPagesProject(JSON.stringify([row('other'), row('job-search')]), 'job-search'), true);
    assert.equal(hasPagesProject(JSON.stringify([row('job-search-old')]), 'job-search'), false);
    assert.equal(hasPagesProject(JSON.stringify([row('x', 'job-search.pages.dev')]), 'job-search'), false);
    assert.equal(hasPagesProject('garbage', 'job-search'), false);
});
test('d1Name reads database_name, null when absent', () => {
    assert.equal(d1Name('name = "x"\n[[d1_databases]]\ndatabase_name = "my-jobs"\n'), 'my-jobs');
    assert.equal(d1Name('name = "x"\n'), null);
});

test('repoFromUrl reads owner/repo from https and ssh remotes', () => {
    assert.equal(repoFromUrl('https://github.com/acme/job-search.git\n'), 'acme/job-search');
    assert.equal(repoFromUrl('git@github.com:acme/job-search.git'), 'acme/job-search');
    assert.equal(repoFromUrl('https://github.com/acme/job-search'), 'acme/job-search');
    assert.equal(repoFromUrl(''), null);
    assert.equal(repoFromUrl('https://example.org/acme/x.git'), null);
});

test('runnersWanted: one per searcher, at least one', () => {
    assert.equal(runnersWanted({ search: { searchers: ['claude', 'codex'] } }), 2);
    assert.equal(runnersWanted({ search: { searchers: ['claude'] } }), 1);
    assert.equal(runnersWanted(undefined), 1);
});

test('runnerFolder is named after the repo', () => {
    assert.equal(runnerFolder('acme/job-search', 1), 'actions-runner-job-search');
    assert.equal(runnerFolder('acme/job-search', 2), 'actions-runner-job-search-2');
});

import { pagesSecretNames, teamHost, audTag, emailAddr, runnerAsset } from '../lib/setupSteps.js';
test('pagesSecretNames reads names from wrangler output', () => {
    const out = 'The "production" environment of your Pages project "x" has access to the following secrets:\n  - ACCESS_AUD: Value Encrypted\n  - GITHUB_REPO: Value Encrypted\n';
    assert.deepEqual(pagesSecretNames(out), ['ACCESS_AUD', 'GITHUB_REPO']);
    assert.deepEqual(pagesSecretNames(''), []);
});
test('page setting flags are cleaned or refused', () => {
    assert.equal(teamHost('https://Acme.cloudflareaccess.com/'), 'acme.cloudflareaccess.com');
    assert.equal(teamHost('acme.example.com'), null);
    assert.equal(audTag(` ${'A'.repeat(64)} `), 'a'.repeat(64));
    assert.equal(audTag('abc'), null);
    assert.equal(emailAddr(' me@example.com '), 'me@example.com');
    assert.equal(emailAddr('me'), null);
});
test('runnerAsset picks the Linux package for the arch', () => {
    const rel = { assets: [{ name: 'actions-runner-osx-x64-2.1.0.tar.gz' }, { name: 'actions-runner-linux-x64-2.1.0.tar.gz' }, { name: 'actions-runner-linux-arm64-2.1.0.tar.gz' }] };
    assert.equal(runnerAsset(rel, 'x64').name, 'actions-runner-linux-x64-2.1.0.tar.gz');
    assert.equal(runnerAsset(rel, 'arm64').name, 'actions-runner-linux-arm64-2.1.0.tar.gz');
    assert.equal(runnerAsset(rel, 'ia32'), null);
});

import { pagesDomain, dashboardSteps } from '../lib/setupSteps.js';
test('pagesDomain picks the pages.dev host of the named project', () => {
    const j = JSON.stringify([{ 'Project Name': 'job-search', 'Project Domains': 'job-search-x1.pages.dev, jobs.example.com' }]);
    assert.equal(pagesDomain(j, 'job-search'), 'job-search-x1.pages.dev');
    assert.equal(pagesDomain(j, 'other'), null);
    assert.equal(pagesDomain('nope', 'x'), null);
});
test('dashboardSteps fills the token links for this repo and account', () => {
    const text = dashboardSteps({ account: 'abc123', repo: 'me/my-search', domain: 'my-search.pages.dev' }).join('\n');
    assert.match(text, /one\.dash\.cloudflare\.com\/abc123\/access\/apps/);
    assert.match(text, /permissionGroupKeys=%5B%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%5D/);
    assert.match(text, /target_name=me&expires_in=366&actions=write&contents=write/);
    assert.match(text, /Only select repositories, then me\/my-search/);
    assert.match(text, /hostname, enter my-search\.pages\.dev/);
});
