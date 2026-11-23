import test from 'node:test';
import assert from 'node:assert/strict';
import { dueTargets, manualTargets, selectRoles, mergeDate, cleanCoverage } from '../lib/monitoring.js';
import { blankCompany } from '../lib/companies.js';
const at = '2026-11-18T10:00:00.000Z';
const co = (name, extra = {}) => ({ ...blankCompany(name), stance: 'Watching', ...extra });
const lead = (c) => ({ id: c.key, companyKey: c.key, wasLead: true, posted: 'yes' });

test('monitoring excludes ruled out before computing active lead, and classifies applications', () => {
 const cs = [co('Lead'), co('App', {applications:[{outcome:'applied'}]}), co('Watch'), co('Out', {stance:'Ruled out'})];
 assert.deepEqual(dueTargets(cs, cs.map(lead), at).map(t=>[t.company,t.group]), [['Lead','lead'],['App','application'],['Watch','lead']]);
});
test('Dormant gets no rotation slot unless it has a lead or application', () => {
 const cs = [co('Dorm',{stance:'Dormant'}), co('DormLead',{stance:'Dormant'}), co('DormApp',{stance:'Dormant',applications:[{outcome:'applied'}]})];
 assert.deepEqual(dueTargets(cs, [lead(cs[1])], at).map(t=>t.company), ['DormLead','DormApp']);
});
test('API model reports cannot postpone verification; legacy and link edits do not satisfy a board check', () => {
 const cs = [co('API',{jobsUrl:'https://jobs.lever.co/api',monitoring:{lastBoardReportedAt:at}}), co('Manual',{monitoring:{lastBoardReportedAt:at}}), co('Legacy',{lastChecked:'2026-11-18',monitoring:{lastLinksTriedAt:at}})];
 assert.deepEqual(dueTargets(cs, [], at).map(t=>t.company), ['API','Legacy']);
 cs[0].monitoring.lastBoardVerifiedAt=at;
 assert.deepEqual(dueTargets(cs, [], at).map(t=>t.company), ['Legacy']);
});
test('15 manual slots reserve five per class, borrow, and rotate failed attempts', () => {
 const cs = ['lead','application','watch'].flatMap(g=>Array.from({length:20},(_,i)=>co(`${g}${String(i).padStart(2,'0')}`, g==='application'?{applications:[{outcome:'applied'}]}:{})));
 const ps=cs.filter(c=>c.name.startsWith('lead')).map(lead);
 const due=dueTargets(cs,ps,at);
 const first=manualTargets(due);
 assert.equal(first.length,15);
 assert.deepEqual(['lead','application','watch'].map(g=>first.filter(t=>t.group===g).length),[5,5,5]);
 for(const c of cs) if(first.some(t=>t.key===c.key)) c.monitoring={lastBoardTriedAt:at};
 assert.ok(manualTargets(dueTargets(cs,ps,at)).every(t=>!first.some(x=>x.key===t.key)));
 assert.equal(manualTargets(due.filter(t=>t.group==='lead')).length,15);
});
test('large board role selection takes one per company per round, then retries least tried roles', () => {
 const cs=[co('A'),co('B'),co('C')];
 const entries=cs.map(c=>({company:c.name,roles:Array.from({length:35},(_,i)=>({id:`${c.key}:${String(i).padStart(2,'0')}`,title:'Software Engineer',url:`https://example.com/${c.key}/${i}`}))}));
 const first=selectRoles(entries,cs,[]);
 assert.deepEqual(first.map(e=>e.roles.length),[10,10,10]);
 const posts=first.flatMap(e=>e.roles.map(r=>({...r,screening:{lastTriedAt:at}})));
 const next=selectRoles(entries,cs,posts);
 assert.deepEqual(next.map(e=>e.roles[0].id),['a:10','b:10','c:10']);
 assert.equal(next.flatMap(e=>e.roles).length,30);
});
test('timestamp merge never travels backward, including sweep scheduling', () => {
 const c={monitoring:{lastSweepScheduledAt:at}};
 mergeDate(c,'monitoring','lastSweepScheduledAt','2026-11-17T10:00:00.000Z');
 assert.equal(c.monitoring.lastSweepScheduledAt,at);
});
test('coverage accepts only assigned companies and current run dates; source is always model reported', () => {
 const targets=[{company:'A'}];
 const raw=[{company:'A',status:'completed',url:'https://a.com/jobs',date:'2026-11-18',source:'script-verified'}, {company:'Other',status:'completed',url:'https://x.com',date:'2026-11-18'},{company:'A',status:'completed',url:'https://a.com',date:'2026-11-19'}];
 assert.deepEqual(cleanCoverage(raw,targets,'2026-11-18'),[{company:'A',status:'completed',url:'https://a.com/jobs',date:'2026-11-18',source:'model-reported'}]);
});
test('daily checks use UTC calendar days even when tomorrow starts a little earlier',()=>{
 const c=co('Lead',{jobsUrl:'https://jobs.lever.co/lead',monitoring:{lastBoardVerifiedAt:'2026-11-17T10:05:00Z'}});
 assert.equal(dueTargets([c],[lead(c)],'2026-11-18T10:00:00Z').length,1);
});
