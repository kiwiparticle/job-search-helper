import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteD1, applySchema } from './sqliteD1.js';
import { loadAll, writeRows, finishedResult } from '../lib/store.js';
import { blankCompany } from '../lib/companies.js';
import { prepareRun, finishRun } from '../lib/run.js';
import { exportData } from '../bin/export-data.js';
const at='2026-11-18T10:00:00.000Z';
const net={lookup:async()=>[{address:'8.8.8.8'}],fetchImpl:async()=>new Response(JSON.stringify({jobs:Array.from({length:35},(_,i)=>({id:i+1,title:`Software Engineer ${i+1}`,absolute_url:`https://boards.greenhouse.io/acme/jobs/${i+1}`}))}))};
async function setup(t, extra={}) {
 const root=mkdtempSync(join(tmpdir(),'coverage-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=sqliteD1();await applySchema(db);
 const co={...blankCompany('Acme'),stance:'Watching',jobsUrl:'https://boards.greenhouse.io/acme',...extra};
 await writeRows(db,{companies:[{id:co.key,version:null,record:co}]});
 const dir=join(root,'runs','2026-11-18-tracked-100000');return {root,db,co,dir};
}
function output(dir,status='ok',coverage=[]) {
 for(const m of ['claude','codex']) {mkdirSync(join(dir,m),{recursive:true});for(const [f,v] of Object.entries({'status.txt':status,'candidates.json':'[]','ledger-patch.json':'[]','coverage.json':JSON.stringify(coverage)}))writeFileSync(join(dir,m,f),v);}
}
const context=dir=>JSON.parse(readFileSync(join(dir,'context.json'),'utf8'));
test('large board omissions stay unreviewed, get attempt dates, export, and rotate on next run',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
 assert.equal((await loadAll(db,'postings')).length,0,'setup is read only');
 assert.equal(context(dir).sweep.flatMap(e=>e.roles).length,30);
 output(dir);await finishRun(db,root,dir,at);
 const ps=(await loadAll(db,'postings')).map(r=>r.record);
 assert.equal(ps.length,35);assert.ok(ps.every(p=>p.modelSays===''));
 assert.equal(ps.filter(p=>p.screening?.lastTriedAt===at).length,30);
 await exportData(db,root);assert.match(readFileSync(join(root,'data','postings.jsonl'),'utf8'),/lastTriedAt/);
 const next=join(root,'runs','2026-11-25-tracked-100000');await prepareRun(db,root,next,'tracked','2026-11-25','2026-11-25T10:00:00.000Z',{...net,executionId:'2'});
 const ids=context(next).sweep.flatMap(e=>e.roles).map(r=>r.id);
 const untried=ps.filter(p=>!p.screening).map(p=>p.id);
 assert.deepEqual(ids.slice(0,5).sort(),untried.sort());
});
test('failed model jobs still record attempts only when finish commits; retries do not repeat writes',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});output(dir,'failed');
 const broken={...db,batch:async()=>{throw Error('offline');}};
 await assert.rejects(finishRun(broken,root,dir,at),/offline/);assert.equal(await finishedResult(db,'2026-11-18-tracked-100000'),null);
 assert.equal((await loadAll(db,'companies'))[0].record.monitoring,undefined);
 await finishRun(db,root,dir,at);const before=await loadAll(db,'companies');assert.equal(before[0].record.monitoring.lastSweepScheduledAt,at);
 await finishRun(db,root,dir,'2026-11-19T10:00:00Z');assert.deepEqual(await loadAll(db,'companies'),before);
});
test('assigned and blocked manual boards never become verified; completed is weak evidence',async t=>{
 const {root,db,dir}=await setup(t,{jobsUrl:'https://acme.example/jobs'});await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
 output(dir,'ok',[{company:'Acme',url:'https://acme.example/jobs',status:'blocked',date:'2026-11-18'}]);
 await finishRun(db,root,dir,at);let c=(await loadAll(db,'companies'))[0].record;
 assert.equal(c.lastChecked,'');assert.equal(c.monitoring.lastBoardVerifiedAt,undefined);assert.equal(c.monitoring.lastBoardReportedAt,undefined);
 const next=join(root,'runs','2026-11-19-tracked-100000');await prepareRun(db,root,next,'tracked','2026-11-19','2026-11-19T10:00:00.000Z',{...net,executionId:'2'});
 output(next,'ok',[{company:'Acme',url:'https://acme.example/jobs',status:'completed',date:'2026-11-19'}]);await finishRun(db,root,next,'2026-11-19T11:00:00Z');
 c=(await loadAll(db,'companies'))[0].record;assert.equal(c.monitoring.lastBoardReportedAt,'2026-11-19T10:00:00.000Z');assert.equal(c.monitoring.lastBoardVerifiedAt,undefined);
});
test('snapshot is fresh and execution identity freezes assignments; collisions reject',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
 assert.match(readFileSync(join(dir,'company-state.jsonl'),'utf8'),/Acme/);
 const old=context(dir);await prepareRun(db,root,dir,'tracked','2026-11-18','2026-11-18T11:00:00Z',{...net,executionId:'1'});assert.deepEqual(context(dir),old);
 await assert.rejects(prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'2'}),/execution|collision/i);
});
test('older finishes cannot move board or sweep fairness timestamps backward',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});output(dir);
 const next=join(root,'runs','2026-11-19-tracked-100000');await prepareRun(db,root,next,'tracked','2026-11-19','2026-11-19T10:00:00.000Z',{...net,executionId:'2'});output(next);
 await finishRun(db,root,next,'2026-11-19T11:00:00Z');await finishRun(db,root,dir,'2026-11-19T12:00:00Z');
 const m=(await loadAll(db,'companies'))[0].record.monitoring;assert.equal(m.lastSweepScheduledAt,'2026-11-19T10:00:00.000Z');assert.equal(m.lastBoardVerifiedAt,'2026-11-19T10:00:00.000Z');
});
test('ruled out after setup gets no role or monitoring updates at finish',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
 const row=(await loadAll(db,'companies'))[0];row.record.stance='Ruled out';await writeRows(db,{companies:[row]});
 output(dir);const candidate={company:'Acme',kind:'role',role:'Software Engineer',url:'https://boards.greenhouse.io/acme/jobs/1',verdict:'Worth interviewing'};
 for(const m of ['claude','codex']) writeFileSync(join(dir,m,'candidates.json'),JSON.stringify([candidate]));
 await finishRun(db,root,dir,at);assert.equal((await loadAll(db,'companies'))[0].record.monitoring,undefined);assert.deepEqual(await loadAll(db,'postings'),[]);
});
test('manual discoveries stay pending and visible',async t=>{
 const {root,db,dir}=await setup(t,{jobsUrl:'https://acme.example/jobs'});await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});output(dir);
 const pending=Array.from({length:15},(_,i)=>({company:'Acme',role:`Software Engineer ${i}`,url:`https://acme.example/jobs/${i}`,kind:'role'}));
 writeFileSync(join(dir,'claude','pending.json'),JSON.stringify(pending));
 const report=await finishRun(db,root,dir,at);assert.equal((await loadAll(db,'postings')).length,15);assert.ok((await loadAll(db,'postings')).every(p=>p.record.modelSays===''));assert.match(report.notes.join(' '),/15 roles remain unreviewed/);
});
test('sendback cannot refill company facts the owner cleared after the original run',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'daily','2026-11-18',at,{executionId:'1'});output(dir);
 const candidate={company:'Acme',kind:'role',role:'Software Engineer',url:'https://boards.greenhouse.io/acme/jobs/1',verdict:'Worth interviewing',facts:'original model facts'};
 for(const m of ['claude','codex']) writeFileSync(join(dir,m,'candidates.json'),JSON.stringify([candidate]));
 await finishRun(db,root,dir,at);
 const row=(await loadAll(db,'companies'))[0];row.record.facts='';await writeRows(db,{companies:[row]});
 await finishRun(db,root,dir,'2026-11-19T11:00:00Z',{sendback:true});assert.equal((await loadAll(db,'companies'))[0].record.facts,'');
});
test('non-tracked workflows never schedule or record attempts for stored unreviewed roles',async t=>{
 const {root,db}=await setup(t);
 await writeRows(db,{postings:[{id:'greenhouse:1',version:null,record:{id:'greenhouse:1',companyKey:'acme',role:'Software Engineer',url:'https://boards.greenhouse.io/acme/jobs/1',modelSays:''}}]});
 for(const wf of ['daily','culture','vertical','reconcile','links','job']) {
  const dir=join(root,'runs',`2026-11-18-${wf}-100000`);await prepareRun(db,root,dir,wf,'2026-11-18',at,{executionId:wf});
  assert.deepEqual(context(dir).sweep,[],wf);output(dir);await finishRun(db,root,dir,at);
 }
 assert.equal((await loadAll(db,'postings'))[0].record.screening,undefined);
});
test('a directed run keeps its direction in the report and the run index',async t=>{
 const {root,db}=await setup(t);const dir=join(root,'runs','2026-11-18-directed-100000');
 await prepareRun(db,root,dir,'directed','2026-11-18',at,{executionId:'d',topic:'Staff graphics roles'});
 output(dir);const report=await finishRun(db,root,dir,at);
 assert.equal(report.topic,'Staff graphics roles');
 assert.equal(JSON.parse(readFileSync(join(root,'runs','index.json'),'utf8'))[0].topic,'Staff graphics roles');
});
test('API failure stays visible and due even when a model reports its fallback completed',async t=>{
 const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,fetchImpl:async()=>new Response('',{status:503}),executionId:'1'});
 output(dir,'ok',[{company:'Acme',url:'https://boards.greenhouse.io/acme',status:'completed',date:'2026-11-18'}]);
 const report=await finishRun(db,root,dir,at);
 assert.match(report.notes.join('\n'),/API verification failed: Acme/);
 assert.match(report.notes.join('\n'),/watch: 1 due.*1 still due/);
 const c=(await loadAll(db,'companies'))[0].record;assert.equal(c.monitoring.lastBoardVerifiedAt,undefined);assert.equal(c.monitoring.lastBoardReportedAt,at);
});

test('30 role screens plus 15 manual discoveries preserve every excess role',async t=>{
 const {root,db,dir}=await setup(t);
 const manual={...blankCompany('Manual'),stance:'Watching',careersUrl:'https://manual.example/jobs'};
 await writeRows(db,{companies:[{id:manual.key,version:null,record:manual}]});
 await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});output(dir);
 const selected=context(dir).sweep.flatMap(e=>e.roles);
 const candidates=selected.map(r=>({company:'Acme',kind:'role',role:r.title,url:r.url,verdict:'Worth interviewing'}));
 const pending=Array.from({length:15},(_,i)=>({company:'Manual',kind:'role',role:`Software Engineer ${i}`,url:`https://manual.example/jobs/${i}`}));
 for(const m of ['claude','codex']) {writeFileSync(join(dir,m,'candidates.json'),JSON.stringify(candidates));writeFileSync(join(dir,m,'pending.json'),JSON.stringify(pending));}
 const report=await finishRun(db,root,dir,at);const posts=(await loadAll(db,'postings')).map(r=>r.record);
 assert.equal(posts.length,50);assert.equal(posts.filter(p=>p.modelSays==='lead').length,30);assert.equal(posts.filter(p=>p.modelSays==='').length,20);assert.match(report.notes.join(' '),/20 roles remain unreviewed/);
});
test('mixed-class capacity overflow reports missed daily and weekly coverage separately',async t=>{
 const {root,db,dir}=await setup(t,{jobsUrl:''});
 const cs=['lead','application','watch'].flatMap(g=>Array.from({length:g==='watch'?19:20},(_,i)=>({...blankCompany(`${g}${i}`),stance:'Watching',...(g==='application'?{applications:[{outcome:'applied'}]}:{})})));
 await writeRows(db,{companies:cs.map(record=>({id:record.key,version:null,record})),postings:cs.filter(c=>c.name.startsWith('lead')).map(c=>({id:c.key,version:null,record:{id:c.key,companyKey:c.key,role:'Senior Engineer',wasLead:true,modelSays:'lead',posted:'yes'}}))});
 await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});output(dir);
 const report=await finishRun(db,root,dir,at);
 for(const group of ['lead','application','watch']) assert.match(report.notes.join('\n'),new RegExp(`${group}: 20 due, 5 manual assigned.*15 deferred by capacity, 20 still due`));
});
test('two executions prepared for the same second cannot silently share a finish marker',async t=>{
 const {root,db,dir}=await setup(t);const other=join(root,'other','2026-11-18-tracked-100000');
 await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});await prepareRun(db,root,other,'tracked','2026-11-18',at,{...net,executionId:'2'});output(dir);output(other);
 await finishRun(db,root,dir,at);await assert.rejects(finishRun(db,root,other,at),/execution collision/);
});
// A route where `ids` searched and `trimmed` says what each dropped; outputs for exactly those ids.
function routed(dir,ids,trimmed,reviewer=null,solo=null){
 for(const m of ids) {mkdirSync(join(dir,m),{recursive:true});for(const [f,v] of Object.entries({'status.txt':'ok','candidates.json':m===solo?.id?JSON.stringify([solo.candidate]):'[]','ledger-patch.json':'[]','coverage.json':'[]'}))writeFileSync(join(dir,m,f),v);}
 writeFileSync(join(dir,'route.json'),JSON.stringify({searchers:ids,reviewer,advisory:[],trimmed}));
}
const dropAll={dropped:1,sweep:['Acme'],manualTargets:['Acme']};
for(const [name,jobsUrl] of [['manual target','https://acme.example/jobs'],['sweep entry','https://boards.greenhouse.io/acme']]) {
 test(`a ${name} every searcher dropped is not stamped and stays due`,async t=>{
  const {root,db,dir}=await setup(t,{jobsUrl});await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
  routed(dir,['qwen'],{qwen:dropAll});
  await finishRun(db,root,dir,at);
  const c=(await loadAll(db,'companies'))[0].record;
  assert.equal(c.monitoring?.lastSweepScheduledAt,undefined);// an API board's lastBoardTriedAt is script evidence, not the model's; only manual boards depend on the searchers
  if(!jobsUrl.includes('greenhouse'))assert.equal(c.monitoring?.lastBoardTriedAt,undefined);
  assert.ok(!(await loadAll(db,'postings')).some(r=>r.record.screening?.lastTriedAt));
  const notes=JSON.parse(readFileSync(join(dir,'report.json'),'utf8')).notes.join('\n');
  assert.match(notes,/0\/0 model-reported/);
 });
 test(`a ${name} one searcher kept is stamped as today`,async t=>{
  const {root,db,dir}=await setup(t,{jobsUrl});await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
  routed(dir,['claude','qwen'],{qwen:dropAll});
  await finishRun(db,root,dir,at);
  const c=(await loadAll(db,'companies'))[0].record;
  assert.ok(c.monitoring.lastSweepScheduledAt===at||c.monitoring.lastBoardTriedAt===at);
 });
}

for(const [reviewer,expected] of [['none',[]],[null,['claude','codex']]]) {
 test(`report.reviewers is ${JSON.stringify(expected)} for reviewer ${reviewer}`,async t=>{
  const {root,db,dir}=await setup(t);await prepareRun(db,root,dir,'tracked','2026-11-18',at,{...net,executionId:'1'});
  const candidate={company:'Acme',kind:'role',role:'Software Engineer',url:'https://boards.greenhouse.io/acme/jobs/1',verdict:'Worth interviewing'};
  routed(dir,['claude','codex'],{},reviewer,{id:'claude',candidate});
  const report=await finishRun(db,root,dir,at);
  assert.deepEqual(report.reviewers,expected);
  if(!expected.length){
   assert.ok(Object.values(report.models).every(m=>!('review' in m)));
   assert.equal(report.leads.length,1);assert.equal(report.leads[0].reviewed,false);
  }
 });
}
