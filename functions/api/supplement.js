import { handleSupplement } from '../lib/handlers.js';

export const onRequestGet = ({ env, request }) => handleSupplement({ db: env.DB, after: new URL(request.url).searchParams.get('after') ?? '' });
