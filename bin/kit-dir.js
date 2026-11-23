#!/usr/bin/env node
import { companyKey } from '../lib/keys.js';

const [company, role] = process.argv.slice(2);
const slug = String(role ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!companyKey(company) || !slug) { console.error('usage: kit-dir.js <company> <role>'); process.exit(2); }
console.log(`applications/${companyKey(company)}-${slug}`);
