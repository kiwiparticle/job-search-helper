export const estimateTokens = (text) => Math.ceil(text.length / 4);
export const limitTokens = (ctx) => Math.floor(ctx * 0.6);

// Drops sweep entries from the end, then manualTargets from the end (and their names from rotation), until fits(ctx).
// Returns { context, dropped } (dropped = entries removed) or null when it never fits. Does not mutate the input.
export function trimContext(context, fits) {
    const ctx = { ...context, sweep: [...(context.sweep ?? [])], manualTargets: [...(context.manualTargets ?? [])], rotation: [...(context.rotation ?? [])] };
    let dropped = 0;
    while (!fits(ctx)) {
        if (ctx.sweep.length) ctx.sweep.pop();
        else if (ctx.manualTargets.length) {
            const t = ctx.manualTargets.pop();
            ctx.rotation = ctx.rotation.filter((n) => n !== t.company);
        } else return null;
        dropped++;
    }
    return { context: ctx, dropped };
}

// Keeps a leading prefix of items whose JSON estimate fits maxTokens.
export function capItems(items, maxTokens) {
    let n = items.length;
    while (n > 0 && estimateTokens(JSON.stringify(items.slice(0, n), null, 2)) > maxTokens) n--;
    return items.slice(0, n);
}
