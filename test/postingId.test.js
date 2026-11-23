import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a, boardId, postingId } from '../lib/postingId.js';

test('fnv1a matches the reference vectors', () => {
    assert.equal(fnv1a(''), '811c9dc5');
    assert.equal(fnv1a('a'), 'e40c292c');
});

test('boardId reads greenhouse, lever, ashby and workday', () => {
    assert.equal(boardId('https://job-boards.greenhouse.io/fundcampus/jobs/4421401009'), 'greenhouse:4421401009');
    assert.equal(boardId('https://acme.com/jobs?gh_jid=987&utm=x'), 'greenhouse:987');
    assert.equal(boardId('https://jobs.lever.co/acme/0b3c1d2e-1111-2222-3333-444455556666'), 'lever:0b3c1d2e-1111-2222-3333-444455556666');
    assert.equal(boardId('https://jobs.ashbyhq.com/acme/0b3c1d2e-1111-2222-3333-444455556666/application'), 'ashby:0b3c1d2e-1111-2222-3333-444455556666');
    assert.equal(boardId('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_jr987'), 'workday:JR987');
});

test('the same workday requisition under different locations gives one id', () => {
    const a = boardId('https://lyceumboard.wd1.myworkdayjobs.com/en-US/Careers/job/Remote/Senior-Engineer_REQ002909');
    assert.equal(a, 'workday:REQ002909');
    assert.equal(boardId('https://lyceumboard.wd1.myworkdayjobs.com/en-US/Careers/job/Remote---USA/Senior-Engineer_REQ002909'), a);
});

test('boardId is null for other URLs and junk', () => {
    for (const u of ['https://example.com/careers', '', 'javascript:x', undefined]) assert.equal(boardId(u), null);
});

test('postingId falls back to a hash of company and role, ignoring the URL', () => {
    const a = postingId({ url: 'https://example.com/careers', company: 'Townworks', role: 'Senior Engineer' });
    assert.match(a, /^key:[0-9a-f]{8}$/);
    assert.notEqual(a, postingId({ url: 'https://example.com/careers', company: 'Townworks', role: 'Staff Engineer' }));
    assert.equal(a, postingId({ url: 'https://vuejobs.com/x', company: 'Townworks', role: 'Senior Engineer' }));
    assert.equal(postingId({ url: 'https://jobs.lever.co/a/0b3c1d2e-1111-2222-3333-444455556666', company: 'A', role: 'B' }), 'lever:0b3c1d2e-1111-2222-3333-444455556666');
});

test('boardId reads bamboohr, breezy, workable and pinpoint', () => {
    assert.equal(boardId('https://rockbranch.bamboohr.com/careers/54'), 'bamboohr:rockbranch:54');
    assert.equal(boardId('https://holdco.breezy.hr/p/4ff64c701d4401-cloud-infrastructure-engineer-open-lms-colombia-remote'), 'breezy:4ff64c701d4401');
    assert.equal(boardId('https://apply.workable.com/j/0E2E2072EC'), 'workable:0E2E2072EC');
    assert.equal(boardId('https://recruiting.paylocity.com/Recruiting/Jobs/Details/4666953'), 'paylocity:4666953');
    assert.equal(boardId('https://recruiting.paylocity.com/recruiting/jobs/Details/4463221/Ron-Turley-Associates-LLC/Senior-Software-Engineer'), 'paylocity:4463221');
    assert.equal(boardId('https://recruiting.paylocity.com/recruiting/jobs/All/0a88105e-c979-4fda-8437-9cbf2ac511e3/Dovetailco-Inc'), null);
    assert.equal(boardId('https://apply.workable.com/it1/j/0e2e2072ec/'), 'workable:0E2E2072EC');
    assert.equal(boardId('https://brightform.pinpointhq.com/en/postings/CDF03CCF-84C1-4C59-AD90-FB1B77ECC0F8'), 'pinpoint:cdf03ccf-84c1-4c59-ad90-fb1b77ecc0f8');
    assert.equal(boardId('https://rockbranch.bamboohr.com/careers'), null);
});

test('boardId reads the newer boards; jobUrlKey matches one job link, never a careers index', async () => {
    const { jobUrlKey, sameLink } = await import('../lib/postingId.js');
    assert.equal(boardId('https://ats.rippling.com/stenwick/jobs/AE602B2A-aea8-4770-a7a2-048df791f7c4'), 'rippling:ae602b2a-aea8-4770-a7a2-048df791f7c4');
    assert.equal(boardId('https://jobs.smartrecruiters.com/Craftly/744000162591554-senior-x'), 'smartrecruiters:744000162591554');
    assert.equal(boardId('https://cargas.na.teamtailor.com/jobs/724582-x'), 'teamtailor:724582');
    assert.equal(boardId('https://mcp.applytojob.com/apply/rNP1xlF0vI/Senior'), 'applytojob:rNP1xlF0vI');
    assert.equal(boardId('https://t.jobs.personio.com/job/12345'), 'personio:12345');
    assert.equal(boardId('https://jobs.gem.com/acme/am9icG9zdDpO7-0Hu'), 'gem:am9icG9zdDpO7-0Hu');
    assert.equal(jobUrlKey('https://acme.com/careers/'), '');
    for (const index of ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=cf3e7f5e-75e2-425c-b471-16a0b1f61090&ccId=1',
        'https://recruiting.paylocity.com/recruiting/jobs/All/13afa810-5782-4e0f-bd66-ca1861e6a9df/Acme',
        'https://recruiting.ultipro.com/DMS1000DMSI/JobBoard/45a5691f-f554-94c1-1066-60b749d0c878/']) assert.equal(jobUrlKey(index), '', index);
    assert.notEqual(jobUrlKey('https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=cf3e7f5e-75e2-425c-b471-16a0b1f61090&jobId=123'), '');
    assert.equal(jobUrlKey('https://www.acme.com/careers/senior-software-engineer-platform/?utm_source=x'), 'acme.com/careers/senior-software-engineer-platform');
    assert.equal(jobUrlKey('https://jobs.ashbyhq.com/a/0b3c1d2e-1111-2222-3333-444455556666/application'), jobUrlKey('https://jobs.ashbyhq.com/a/0b3c1d2e-1111-2222-3333-444455556666'));
    const ps = [{ id: 'key:1', companyKey: 'a', url: 'https://x.com/jobs/12345' }, { id: 'key:2', companyKey: 'a', url: 'https://x.com/careers' }];
    assert.equal(sameLink(ps, 'a', 'https://x.com/jobs/12345/apply')?.id, 'key:1');
    assert.equal(sameLink(ps, 'b', 'https://x.com/jobs/12345'), undefined);
    assert.equal(sameLink(ps, 'a', 'https://x.com/careers'), undefined);
});
