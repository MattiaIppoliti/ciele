import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accept, same, CONTEXT } from './local-validation.mjs';
const expected = {owner:'owner',base:'b'.repeat(40),tree:'t'.repeat(40)};
const good={context:CONTEXT,state:'success',creator:{login:'owner'},description:`base=${expected.base} tree=${expected.tree}`};
assert.ok(accept([good],expected));
for (const patch of [{state:'failure'}, {creator:{login:'contributor'}}, {description:'stale'}, {context:'CI'}]) assert.equal(accept([{...good,...patch}],expected),false);
assert.equal(accept([{...good,state:'failure'},good],expected),false,'latest failed local run cannot reuse old success');
assert.equal(accept([],expected),false);
const snapshot={head:'h',base:'b',tree:'t',node:'v22',pnpm:'10'};
for(const key of Object.keys(snapshot)) assert.equal(same(snapshot,{...snapshot,[key]:'changed'}),false,`${key} invalidates receipt`);
assert.ok(same(snapshot,{...snapshot,finished:'later'}));
// Real Git integration: exact PR head/base/tree accepted, stale base and merge tree rejected.
const temp=mkdtempSync(join(tmpdir(),'local-validation-test-'));
const script=join(dirname(fileURLToPath(import.meta.url)),'local-validation.mjs');
try {
 const git=(...args)=>execFileSync('git',args,{cwd:temp,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 writeFileSync(join(temp,'file'),'base');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 git('update-ref','refs/remotes/origin/main',base);
 writeFileSync(join(temp,'file'),'feature');git('add','.');git('commit','-qm','feature');const head=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
 mkdirSync(join(temp,'bin'));const statuses=[{...good,description:`base=${base} tree=${tree}`}];
 const gh=join(temp,'bin','gh');writeFileSync(gh,`#!/usr/bin/env node\nconst route=process.argv[3];process.stdout.write(JSON.stringify(route.endsWith('/pulls')?JSON.parse(process.env.TEST_PRS||'[]'):{statuses:JSON.parse(process.env.TEST_STATUSES)}));\n`,{mode:0o755});
 const eventPath=join(temp,'.git','event.json'),output=join(temp,'.git','output');
 const invoke=(event,name='pull_request',extra={})=>{
  writeFileSync(eventPath,JSON.stringify(event));writeFileSync(output,'');
  return spawnSync(process.execPath,[script,'gate'],{cwd:temp,encoding:'utf8',env:{...process.env,PATH:`${join(temp,'bin')}:${process.env.PATH}`,GITHUB_EVENT_PATH:eventPath,GITHUB_OUTPUT:output,GITHUB_EVENT_NAME:name,GITHUB_REPOSITORY:'owner/repo',GITHUB_SHA:head,TEST_STATUSES:JSON.stringify(statuses),...extra}});
 };
 const event={pull_request:{head:{sha:head,repo:{full_name:'owner/repo'}},base:{sha:base}}};
 assert.equal(invoke(event).status,0);assert.match(readFileSync(output,'utf8'),/skip=true/);
 assert.notEqual(invoke({...event,pull_request:{...event.pull_request,base:{sha:head}}}).status,0);
 assert.notEqual(invoke(event,'pull_request',{TEST_STATUSES:'[]'}).status,0);assert.equal(readFileSync(output,'utf8'),'');
 assert.notEqual(invoke({...event,pull_request:{...event.pull_request,head:{sha:head,repo:{full_name:'fork/repo'}}}}).status,0);
 assert.equal(invoke({before:base},'push',{TEST_PRS:JSON.stringify([{merge_commit_sha:head,head:{sha:head},base:{ref:'main'}}])}).status,0);
 assert.notEqual(invoke({before:head},'push',{TEST_PRS:JSON.stringify([{merge_commit_sha:head,head:{sha:head},base:{ref:'main'}}])}).status,0);
 assert.notEqual(invoke({before:base},'push').status,0,'direct push cannot inherit a receipt');
 writeFileSync(join(temp,'file'),'different merge');git('add','.');git('commit','-qm','merge changed');
 assert.notEqual(invoke(event).status,0,'different tested merge tree rejected');
} finally {rmSync(temp,{recursive:true,force:true});}
console.log('Local evidence regression checks passed (owner, failure, revision/runtime invalidation, stale base, fork, direct push and merge tree).');
