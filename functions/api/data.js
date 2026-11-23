import { makeGithub } from '../lib/github.js';
import { handleData } from '../lib/handlers.js';

export const onRequestGet = ({ request, env }) =>
    handleData(new URL(request.url).searchParams.get('path'), { when: new URL(request.url).searchParams.has('when'), gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }) });
