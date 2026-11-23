// Model output can carry `javascript:` or `data:` links; only web links and same-site paths become hrefs.
export function safeHref(url) {
    const u = String(url ?? '').trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null;
    return u;
}
