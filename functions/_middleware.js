import { verifyAccessJwt, accessCertsFetcher } from './lib/access.js';

let fetchCerts;
const SETTINGS = ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'OWNER_EMAIL', 'GITHUB_REPO', 'GITHUB_TOKEN'];

// Every request, static pages included, must carry a valid Access token for the owner.
export async function onRequest({ request, env, next }) {
    // Names only, never values: tells a half-set-up install what is left.
    const missing = SETTINGS.filter((k) => !env[k]);
    if (missing.length) return new Response(`Setup incomplete: ${missing.join(', ')} not set. Run node bin/setup.js.\n`, { status: 503 });
    fetchCerts ??= accessCertsFetcher(env.ACCESS_TEAM_DOMAIN);
    try {
        await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
            teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL, fetchCerts,
        });
    } catch {
        return new Response('Forbidden', { status: 403 });
    }
    return next();
}
