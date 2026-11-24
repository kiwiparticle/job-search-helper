import { makeGithub } from '../lib/github.js';
import { handleToken } from '../lib/handlers.js';

export const onRequestGet = ({ env }) => handleToken({ gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }) });
