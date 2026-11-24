const utf8ToB64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
};
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

export function makeGithub({ token, repo, fetchImpl = fetch }) {
    const api = (path, init = {}) => fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'job-search-board', 'x-github-api-version': '2022-11-28', ...(init.headers ?? {}) },
    });
    const fail = async (res) => {
        const e = new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
        e.status = res.status;
        throw e;
    };
    const getRaw = async (path) => {
        const res = await api(`/contents/${path}`, { headers: { accept: 'application/vnd.github.raw' } });
        if (!res.ok) await fail(res);
        return res;
    };
    return {
        async getFile(path) {
            const res = await api(`/contents/${path}`);
            if (!res.ok) await fail(res);
            const j = await res.json();
            // Over 1 MB the JSON `content` comes back empty (encoding "none"); the raw media type still works.
            const text = j.encoding === 'none' ? await (await getRaw(path)).text() : b64ToUtf8(j.content);
            return { text, sha: j.sha };
        },
        getRaw,
        // ISO time of the newest commit that touched a path ('' when none).
        async lastCommitAt(path) {
            const res = await api(`/commits?path=${encodeURIComponent(path)}&per_page=1`);
            if (!res.ok) await fail(res);
            return (await res.json())[0]?.commit.committer.date ?? '';
        },
        async putFile(path, text, sha, message) {
            const res = await api(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: utf8ToB64(text), sha }) });
            if (!res.ok) await fail(res);
        },
        async listActiveRuns() {
            const runs = [];
            for (const status of ['in_progress', 'queued']) {
                const res = await api(`/actions/runs?status=${status}&per_page=10`);
                if (!res.ok) await fail(res);
                runs.push(...(await res.json()).workflow_runs);
            }
            return runs;
        },
        // Newest first, every status: queued, running and finished.
        // The token itself: HTTP status of a cheap repo read, and GitHub's expiry header ('2026-12-31 23:59:59 UTC', absent when it never expires).
        async tokenStatus() {
            const res = await api('');
            return { status: res.status, expires: res.headers.get('github-authentication-token-expiration') };
        },
        async listRecentRuns() {
            const res = await api('/actions/runs?per_page=100');
            if (!res.ok) await fail(res);
            return (await res.json()).workflow_runs;
        },
        async listJobs(runId) {
            const res = await api(`/actions/runs/${runId}/jobs?per_page=20`);
            if (!res.ok) await fail(res);
            return (await res.json()).jobs;
        },
        async listDir(path) {
            const res = await api(`/contents/${path}`);
            if (res.status === 404) return [];
            if (!res.ok) await fail(res);
            return res.json();
        },
        async dispatch(workflow, inputs) {
            const res = await api(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });
            if (!res.ok) await fail(res);
        },
    };
}
