#!/usr/bin/env node
// usage: kit-review-finish.js <kitDir> <rawDir>   (rawDir/<model>/review.md and review.json)
// Writes review-<model>.md into the kit and merges the reviews into kit.json. Exits 1 if no review arrived.
import fs from 'node:fs';
import path from 'node:path';
import { readReview, mergeReviews } from '../lib/kitReview.js';

const [kitDir, rawDir] = process.argv.slice(2);
const reviews = [];
for (const model of ['claude', 'codex']) {
    const md = path.join(rawDir, model, 'review.md');
    const js = path.join(rawDir, model, 'review.json');
    if (!fs.existsSync(md) || !fs.existsSync(js)) continue;
    const r = readReview(fs.readFileSync(js, 'utf8'));
    if (!r) { console.error(`${model}: review.json unreadable, skipped`); continue; }
    fs.writeFileSync(path.join(kitDir, `review-${model}.md`), fs.readFileSync(md, 'utf8').slice(0, 20000));
    reviews.push({ model, ...r });
}
if (!reviews.length) { console.error('no review arrived'); process.exit(1); }
const kitFile = path.join(kitDir, 'kit.json');
const kit = fs.existsSync(kitFile) ? JSON.parse(fs.readFileSync(kitFile, 'utf8')) : {};
fs.writeFileSync(kitFile, JSON.stringify(mergeReviews(kit, reviews, new Date().toISOString()), null, 2) + '\n');
console.log(`reviewed by ${reviews.map((r) => r.model).join(', ')}`);
