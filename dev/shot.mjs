// Screenshots the preview page: node dev/shot.mjs '#/decide' out.png [width] [height]
// Prints console errors. Use page.route() in your own script to inject fixture data.
import { chromium } from 'playwright';

const [hash = '#/run', out = 'shot.png', width = '1440', height = '900'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${process.env.PORT ?? 8099}/${hash}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
