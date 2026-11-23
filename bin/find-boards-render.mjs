#!/usr/bin/env node
// find-boards.yml render (no token): opens each target page in headless Chromium and records every URL the page
// requested or links to, so a careers page drawn by script still shows which job board it reads. Writes <out>/observed.json.
// Untrusted pages: this job holds no token, and finish trusts nothing here but URLs it parses and checks itself.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) { console.error('usage: find-boards-render.mjs <targets dir> <out dir>'); process.exit(2); }
const targets = JSON.parse(readFileSync(join(inDir, 'targets.json'), 'utf8'));
const MAX_URLS = 100;
// Only URLs on job-board hosts go back: finish reads nothing else, and collect-output.sh caps the file at 2 MB.
const BOARD_HOST = /^https?:\/\/[^/]*(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|bamboohr\.com|breezy\.hr|pinpointhq\.com|rippling\.com|myworkday(jobs|site)\.com|smartrecruiters\.com|recruitee\.com|personio\.(de|com)|teamtailor\.com|applytojob\.com|paylocity\.com|gem\.com)[/:?]/i;
const keep = (seen, u) => { const s = String(u).slice(0, 1000); if (seen.size < MAX_URLS && BOARD_HOST.test(s)) seen.add(s); };
const browser = await chromium.launch();
const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });
// Images, fonts and media never name a board; skipping them makes each page faster.
await context.route('**/*', (r) => (['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
const observed = [];
const queue = [...targets];
await Promise.all(Array.from({ length: 4 }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
        const seen = new Set();
        const page = await context.newPage();
        page.on('request', (r) => keep(seen, r.url()));
        try {
            await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            const links = await page.evaluate(() => [...document.querySelectorAll('a[href], iframe[src]')].map((e) => e.href || e.src));
            for (const u of links) keep(seen, u);
            for (const f of page.frames()) keep(seen, f.url());
        } catch { /* timed out or blocked: keep what loaded */ }
        await page.close().catch(() => {});
        if (seen.size) observed.push({ key: t.key, seen: [...seen] });
    }
}));
await browser.close();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'observed.json'), JSON.stringify(observed) + '\n');
console.log(`rendered ${observed.length} pages`);
