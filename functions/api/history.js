import { handleHistory } from '../lib/handlers.js';

export const onRequestGet = ({ env, request }) => handleHistory({ db: env.DB, company: new URL(request.url).searchParams.get('company') ?? '' });
