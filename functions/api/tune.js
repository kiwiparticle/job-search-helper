import { handleTune } from '../lib/handlers.js';

export const onRequestGet = ({ env, request }) => handleTune({ db: env.DB, after: new URL(request.url).searchParams.get('after') ?? '' });
