import { makeGithub } from '../lib/github.js';
import { handleActivity } from '../lib/handlers.js';

export const onRequestGet = ({ env }) => handleActivity({ gh: makeGithub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO }), db: env.DB });
