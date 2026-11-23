import { makeGithub } from '../lib/github.js';
import { handleStatus } from '../lib/handlers.js';

export const onRequestGet = ({ env }) => handleStatus({ gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }) });
