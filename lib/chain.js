// Decides whether a finished "judge all" batch should start another. Pure: bin/chain-next.js does the dispatch.
// Stops when nothing was judged (a failing model can't loop), nothing is left, or the batch budget is spent.
export const CHAIN_BATCHES = 10;
export function nextBatch(report, route, chain) {
    const left = Number(chain);
    const { judged = 0, left: remaining = 0 } = report?.sweep ?? {};
    if (!Number.isInteger(left) || left < 1 || judged < 1 || remaining < 1) return null;
    return { workflow: 'tracked', sweep_roles: '30', chain: String(left - 1), searchers: route.searchers.join(','), reviewer: route.reviewer ?? 'each' };
}
