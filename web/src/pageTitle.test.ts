import { expect, test } from 'vitest';
import { pageTitle } from './pageTitle';

const ctx = { newCount: 14, companies: [{ key: 'acme', name: 'Acme' }], postings: [{ id: 'p1', role: 'Staff Engineer', companyKey: 'acme' }] } as any;

test('page titles name the page, and the thing on detail pages', () => {
    expect(pageTitle('/new', ctx)).toBe('New (14) · Job search');
    expect(pageTitle('/new', { ...ctx, newCount: 0 })).toBe('New · Job search');
    expect(pageTitle('/jobs', ctx)).toBe('Jobs · Job search');
    expect(pageTitle('/jobs/p1', ctx)).toBe('Staff Engineer, Acme · Job search');
    expect(pageTitle('/companies/acme', ctx)).toBe('Acme · Job search');
    expect(pageTitle('/companies/nope', ctx)).toBe('Company · Job search');
    expect(pageTitle('/runs/2026-11-17-daily', ctx)).toBe('Run 2026-11-17-daily · Job search');
    expect(pageTitle('/kits', ctx)).toBe('Kits · Job search');
    expect(pageTitle('/directed', ctx)).toBe('Directed · Job search');
    expect(pageTitle('/passed', ctx)).toBe('Passed · Job search');
    expect(pageTitle('/status', ctx)).toBe('Status · Job search');
});

test('a kit page keeps its own title', () => {
    expect(pageTitle('/kits/acme-staff', ctx)).toBeNull();
    expect(pageTitle('/kits/acme-staff/preview/resume.docx', ctx)).toBeNull();
});
