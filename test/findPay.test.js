import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPay } from '../lib/findPay.js';

const yes = (text, want) => assert.equal(findPay(text), want, text);

test('finds ranges in common shapes', () => {
    yes('The base salary is $123,000 - $234,000 per year.', '$123,000 - $234,000');
    yes('Pay range: $123,000–$234,000', '$123,000–$234,000');
    yes('$120k to $150k + equity', '$120k to $150k');
    yes('$120-140k', '$120-140k');
    yes('between $ 150,000 and $180,000 USD', '$ 150,000 and $180,000');
    yes('<p>Salary: $165000-$190000</p>', '$165000-$190000');
});

test('finds a lone figure only next to a pay word', () => {
    yes('Our annual salary for this role is $180,000.', '$180,000');
    yes('Base: $175k', '$175k');
    yes('We reimburse up to $5,000 of equipment.', null);
    yes('Buy it for $123,456 today', null);
});

test('hourly needs an hour unit and a sane rate', () => {
    yes('Pay is $65/hour', '$65/hr');
    yes('It costs $65 to join', null);
});

test('ignores funding, revenue and small amounts', () => {
    yes('We raised $50 million and have $100M in revenue.', null);
    yes('We raised $120,000 - $150,000 from angels', null);
    yes('$1,000 home office stipend and $500 learning budget', null);
    yes('$2.5B valuation', null);
    yes('', null);
    yes(null, null);
});

test('keeps up to three distinct ranges (location tiers)', () => {
    yes('CO: $140,000 - $160,000. NY: $150,000 - $170,000. CA: $160,000 - $180,000. WA: $155,000 - $175,000. CO: $140,000 - $160,000.',
        '$140,000 - $160,000 | $150,000 - $170,000 | $160,000 - $180,000');
});

import { payFor } from '../lib/postingCheck.js';
const pub = async () => [{ address: '93.184.216.34', family: 4 }];
const page = (body) => async () => new Response(body, { status: 200 });

test('payFor reads Greenhouse fields, Lever fields and plain page text', async () => {
    const gh = JSON.stringify({ pay_input_ranges: [{ min_cents: 15000000, max_cents: 18000000 }] });
    assert.equal(await payFor('https://boards.greenhouse.io/acme/jobs/123', { fetchImpl: page(gh), lookup: pub }), '$150,000–$180,000');
    const lv = JSON.stringify({ salaryRange: { min: 140000, max: 170000 } });
    assert.equal(await payFor('https://jobs.lever.co/acme/0b1c2d3e-0000-4000-8000-000000000001', { fetchImpl: page(lv), lookup: pub }), '$140000–$170000');
    assert.equal(await payFor('https://acme.com/jobs/x', { fetchImpl: page('<p>Benefits</p><p>Base pay: $130,000 - $160,000</p>'), lookup: pub }), '$130,000 - $160,000');
    assert.equal(await payFor('https://acme.com/jobs/x', { fetchImpl: page('<p>no money here</p>'), lookup: pub }), null);
});
