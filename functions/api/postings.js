import { handlePostings } from '../lib/handlers.js';

export const onRequestGet = ({ env, request }) => {
    const q = new URL(request.url).searchParams;
    return handlePostings({ db: env.DB, after: q.get('after') ?? '', since: q.get('since') });
};
