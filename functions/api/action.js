import { makeGithub } from '../lib/github.js';
import { handleAction, checkActionRequest } from '../lib/handlers.js';

export async function onRequestPost({ request, env }) {
    const refused = checkActionRequest(request);
    if (refused) return refused;
    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    return handleAction(body, {
        gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }),
        db: env.DB,
    });
}
