const dec = (s) => JSON.parse(new TextDecoder().decode(b64(s)));
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

export const accessCertsFetcher = (teamDomain) => {
    let cache = null;
    return async () => {
        if (cache && cache.until > Date.now()) return cache.certs;
        const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
        if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
        cache = { certs: await res.json(), until: Date.now() + 10 * 60 * 1000 };
        return cache.certs;
    };
};

export async function verifyAccessJwt(token, { teamDomain, aud, ownerEmail, fetchCerts, now = () => Math.floor(Date.now() / 1000) }) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) throw new Error('malformed token');
    const [h, p, s] = parts;
    const header = dec(h);
    if (header.alg !== 'RS256') throw new Error('bad alg');
    const { keys } = await fetchCerts();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('unknown key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) throw new Error('bad signature');
    const claims = dec(p);
    if (claims.iss !== `https://${teamDomain}`) throw new Error('bad iss');
    if (![].concat(claims.aud).includes(aud)) throw new Error('bad aud');
    if (!(claims.exp > now())) throw new Error('token expired');
    if (!ownerEmail || String(claims.email).toLowerCase() !== String(ownerEmail).toLowerCase()) throw new Error('bad email');
    return { email: claims.email };
}
