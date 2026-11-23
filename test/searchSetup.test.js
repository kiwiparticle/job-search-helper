import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Exercise the actual setup shell, replacing only GitHub metadata and the D1 CLI boundary.
const workflow=readFileSync(new URL('../.github/workflows/search.yml',import.meta.url),'utf8');
const section=workflow.split('      - id: s\n')[1].split("      - uses: actions/upload-artifact")[0];
const script=section.split('        run: |\n')[1].split('\n').map(l=>l.replace(/^          /,'')).join('\n');
const run='2026-11-18-tracked-100005';
function setup(t, attempt='1') {
 const root=mkdtempSync(join(tmpdir(),'search-setup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'gh'),'#!/bin/sh\nprintf "%s\\n" "2026-11-18T10:00:05Z"\n',{mode:0o755});
 writeFileSync(join(bin,'node'),'#!/bin/sh\nprintf "%s|%s\\n" "$EXECUTION_ID" "$*" > prepare-call\n',{mode:0o755});
 const env={PATH:`${bin}:/usr/bin:/bin`,WF_INPUT:'tracked',EXECUTION_ID:'123',GITHUB_RUN_ID:'123',GITHUB_REPOSITORY:'owner/jobs',GITHUB_RUN_ATTEMPT:attempt,GITHUB_OUTPUT:join(root,'outputs')};
 return {root,run:()=>spawnSync('/bin/bash',['-e','-c',script],{cwd:root,env,encoding:'utf8'})};
}
test('setup derives a stable HHMMSS folder from execution creation time',t=>{
 const s=setup(t);assert.equal(s.run().status,0);assert.match(readFileSync(join(s.root,'outputs'),'utf8'),/run=2026-11-18-tracked-100005/);assert.match(readFileSync(join(s.root,'prepare-call'),'utf8'),/123\|bin\/prepare.js runs\/2026-11-18-tracked-100005 tracked 2026-11-18/);
});
test('workflow retry restores all three frozen prep artifacts into the same run folder',t=>{
 const s=setup(t,'2');for(const name of ['context.json','base.jsonl','company-state.jsonl']) {const dir=join(s.root,'.preparation',`prep-${name}`);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),`original ${name}`);}
 assert.equal(s.run().status,0);for(const name of ['context.json','base.jsonl','company-state.jsonl'])assert.equal(readFileSync(join(s.root,'runs',run,name),'utf8'),`original ${name}`);
});
test('expired preparation artifacts reject retry before calling the D1 prepare CLI',t=>{
 const s=setup(t,'2');const result=s.run();assert.notEqual(result.status,0);assert.match(result.stdout,/missing preparation artifact/);assert.throws(()=>readFileSync(join(s.root,'prepare-call')),{code:'ENOENT'});
});
