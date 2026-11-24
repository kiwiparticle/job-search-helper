import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { verifyAccessJwt } from '../functions/lib/access.js';

const { subtle } = webcrypto;
const b64url = (buf) => Buffer.from(buf).toString('base64url');

const keyPair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1', alg: 'RS256' };
const fetchCerts = async () => ({ keys: [jwk] });

const NOW = 1_800_000_000;
const OPTS = { teamDomain: 'kiwi.cloudflareaccess.com', aud: 'aud-tag', ownerEmail: 'owner@example.com', fetchCerts, now: () => NOW };

async function sign(claims, { kid = 'k1', key = keyPair.privateKey } = {}) {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iss: 'https://kiwi.cloudflareaccess.com', aud: ['aud-tag'], email: 'owner@example.com', exp: NOW + 60, iat: NOW, ...claims }));
    const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64url(sig)}`;
}

test('a valid owner token passes', async () => {
    assert.deepEqual(await verifyAccessJwt(await sign({}), OPTS), { email: 'owner@example.com' });
});
test('email match ignores case', async () => {
    assert.equal((await verifyAccessJwt(await sign({ email: 'Owner@Example.com' }), OPTS)).email, 'Owner@Example.com');
});
test('wrong aud throws', async () => {
    await assert.rejects(verifyAccessJwt(await sign({ aud: ['other'] }), OPTS), /aud/);
});
test('expired token throws', async () => {
    await assert.rejects(verifyAccessJwt(await sign({ exp: NOW - 1 }), OPTS), /expired/);
});
test('different email throws', async () => {
    await assert.rejects(verifyAccessJwt(await sign({ email: 'someone@else.com' }), OPTS), /email/);
});
test('wrong issuer throws', async () => {
    await assert.rejects(verifyAccessJwt(await sign({ iss: 'https://evil.cloudflareaccess.com' }), OPTS), /iss/);
});
test('signature from another key throws', async () => {
    const other = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
    await assert.rejects(verifyAccessJwt(await sign({}, { key: other.privateKey }), OPTS), /signature/);
});
test('unknown kid throws', async () => {
    await assert.rejects(verifyAccessJwt(await sign({}, { kid: 'nope' }), OPTS), /key/);
});
test('missing or garbage token throws', async () => {
    await assert.rejects(verifyAccessJwt('', OPTS));
    await assert.rejects(verifyAccessJwt('a.b', OPTS));
});
test('alg none is rejected', async () => {
    const head = b64url(JSON.stringify({ alg: 'none', kid: 'k1' }));
    const body = b64url(JSON.stringify({ iss: 'https://kiwi.cloudflareaccess.com', aud: ['aud-tag'], email: 'owner@example.com', exp: NOW + 60 }));
    await assert.rejects(verifyAccessJwt(`${head}.${body}.`, OPTS), /alg/);
});

import { onRequest } from '../functions/_middleware.js';
test('middleware names missing settings, never values, before any auth', async () => {
    const res = await onRequest({ request: new Request('https://x/'), env: { ACCESS_AUD: 'secret-aud', GITHUB_REPO: 'a/b' }, next: () => assert.fail('passed') });
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.match(text, /ACCESS_TEAM_DOMAIN, OWNER_EMAIL, GITHUB_TOKEN not set/);
    assert.doesNotMatch(text, /secret-aud/);
});
