import { handleCompanies } from '../lib/handlers.js';

export const onRequestGet = ({ env, request }) => {
    const q = new URL(request.url).searchParams;
    return handleCompanies({ db: env.DB, after: q.get('after') ?? '', since: q.get('since') });
};
