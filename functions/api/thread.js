import { makeGithub } from '../lib/github.js';
import { handleThread } from '../lib/handlers.js';

export const onRequestGet = ({ request, env }) =>
    handleThread(new URL(request.url).searchParams.get('company'), { gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }) });
