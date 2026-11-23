import { verifyAccessJwt, accessCertsFetcher } from './lib/access.js';

let fetchCerts;

// Every request, static pages included, must carry a valid Access token for the owner.
export async function onRequest({ request, env, next }) {
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
