export const dataUrl = (path: string) => `/api/data?path=${encodeURIComponent(path)}`;

async function data(path: string) {
    const res = await fetch(dataUrl(path));
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res;
}
export const getJson = async <T = any>(path: string): Promise<T> => (await data(path)).json();
export const getBlob = async (path: string) => (await data(path)).blob();
export const getText = async (path: string) => (await data(path)).text();

// A guard wants a yes before it will go ahead: ask, then resend with confirmed: true.
export class NeedsConfirm extends Error {}

export async function act(body: Record<string, unknown>) {
    const res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 409 && out.needsConfirm) throw new NeedsConfirm(out.error);
    if (res.status === 409) throw new Error(out.error ?? 'Someone else changed this at the same moment. Reload and try again.');
    if (!res.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
    return out;
}
