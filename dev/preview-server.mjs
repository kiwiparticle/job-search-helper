// Serves the built page (dist/) with the repo's files behind /api/*, so the page can be checked in a browser
// without Cloudflare or GitHub. data/*.jsonl (the daily export) is loaded into an in-memory database that the real
// handlers read and write; writes work while the server runs and are discarded on exit.
//   pnpm run preview            (builds, then serves on http://localhost:8099)
//   PREVIEW_DATA=<path> pnpm run preview   (data, owner files and runs/ from another checkout; code stays here)
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const data = process.env.PREVIEW_DATA ? resolve(process.env.PREVIEW_DATA) : repo;
const port = Number(process.env.PORT ?? 8099);
const { isAllowedPath, handleCompanies, handlePostings, handleHistory, handleAction, checkActionRequest } = await import(join(repo, 'functions/lib/handlers.js'));
const { sqliteD1, applySchema } = await import(join(repo, 'test/sqliteD1.js'));
const { writeRows } = await import(join(repo, 'lib/store.js'));

const readLines = async (name) => (await readFile(join(data, 'data', name), 'utf8').catch(() => '')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const db = sqliteD1();
await applySchema(db);
const [companies, postings, history] = await Promise.all(['companies', 'postings', 'history'].map((n) => readLines(`${n}.jsonl`)));
if (!companies.length) console.log('No data/*.jsonl yet (it appears after the cutover): starting with an empty database.');
const byCompany = Map.groupBy(history, (h) => h.companyKey);
await writeRows(db, {
    companies: companies.map((record) => ({ id: record.key, version: null, record })),
    postings: postings.map((record) => ({ id: record.id, version: null, record })),
    history: [...byCompany].map(([companyKey, rows]) => ({ companyKey, rows: rows.map(({ companyKey: _k, ...row }) => row) })),
});

const gh = {
    getFile: async (f) => ({ text: await readFile(join(data, f), 'utf8'), sha: 'x' }),
    dispatch: async () => {},
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const send = (res, r) => r.text().then((text) => { res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(text); });
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
        const after = u.searchParams.get('after') ?? '';
        const since = u.searchParams.get('since');
        if (u.pathname === '/api/companies') return send(res, await handleCompanies({ db, after, since }));
        if (u.pathname === '/api/postings') return send(res, await handlePostings({ db, after, since }));
        if (u.pathname === '/api/history') return send(res, await handleHistory({ db, company: u.searchParams.get('company') ?? '' }));
        if (u.pathname === '/api/activity') return json(res, { runs: [
            { id: 1, workflow: 'kit-revise', title: 'revise Acme | Staff Engineer', status: 'in_progress', conclusion: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: 'https://github.com' },
            { id: 2, workflow: 'kit-add', title: 'piece Acme | Staff Engineer', status: 'queued', conclusion: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: 'https://github.com' },
            { id: 3, workflow: 'kit', title: 'kit Globex | Principal', status: 'completed', conclusion: 'success', createdAt: new Date().toISOString(), updatedAt: new Date(Date.now() - 3600000).toISOString(), url: 'https://github.com' },
        ] });
        if (u.pathname === '/api/status') return json(res, { runs: [] });
        if (u.pathname === '/api/thread') {
            // Real thread if one exists, else a sample so the Ask panel has something to show.
            const company = u.searchParams.get('company') ?? '';
            const { threadPath } = await import(join(repo, 'lib/ask.js'));
            const real = await readFile(join(data, threadPath(company)), 'utf8').catch(() => null);
            return json(res, real ? JSON.parse(real) : { company, messages: [] });
        }
        if (u.pathname === '/api/data') {
            const p = u.searchParams.get('path');
            if (!isAllowedPath(p)) { res.writeHead(403); return res.end(); }
            const full = join(data, p);
            if ((await stat(full)).isDirectory()) return json(res, (await readdir(full, { withFileTypes: true })).map((d) => ({ name: d.name, type: d.isDirectory() ? 'dir' : 'file' })));
            return res.end(await readFile(full));
        }
        if (u.pathname === '/api/action' && req.method === 'POST') {
            const body = Buffer.concat(await req.toArray()).toString();
            const request = new Request(new URL(req.url, `http://${req.headers.host}`), { method: 'POST', headers: req.headers, body });
            const refused = checkActionRequest(request);
            if (refused) return send(res, refused);
            return send(res, await handleAction(JSON.parse(body), { gh, db }));
        }
        const f = join(repo, 'dist', u.pathname === '/' ? 'index.html' : u.pathname);
        const file = await readFile(f); // read first: a missing file must reach the 404 below before headers go out
        res.writeHead(200, { 'content-type': types[extname(f)] ?? 'text/plain' });
        res.end(file);
    } catch { res.writeHead(404); res.end(); }
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
