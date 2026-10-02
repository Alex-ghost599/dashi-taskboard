import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {previewProjectConversations} from '../server/conversation-import-preview.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'conversation-preview-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const sessions=path.join(root,'sessions');await mkdir(path.join(sessions,'2026/10/02'),{recursive:true});
  const workspace=path.join(root,'project');await mkdir(workspace);
  const add=async(name,id,cwd,extra='')=>{
    const file=path.join(sessions,'2026/10/02',name+'.jsonl');
    await writeFile(file,JSON.stringify({type:'session_meta',payload:{id,cwd,timestamp:'2026-10-02T00:00:00Z'}})+'\n'+extra);
    return file;
  };
  return {root,sessions,workspace,add};
}
const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';

test('exact metadata cwd filters neighboring projects without inferring status or execution ownership',async t=>{
  const {sessions,workspace,add}=await fixture(t);
  const file=await add('one',first,workspace,'{"type":"event_msg","payload":{"message":"private body"}}\n');
  await add('neighbor',second,workspace+'-other');
  const before=await readFile(file);
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace},existing:[]});
  assert.equal(result.candidates.length,1);
  assert.equal(result.candidates[0].threadId,first);
  assert.equal(result.candidates[0].status,null);
  assert.equal(result.candidates[0].executionBinding,null);
  assert.equal(result.authorizesDispatch,false);
  assert.equal(result.saved,false);
  assert.ok(!JSON.stringify(result).includes('private body'));
  assert.deepEqual(await readFile(file),before);
});

test('same thread id is deduplicated and existing project cards are surfaced for review',async t=>{
  const {sessions,workspace,add}=await fixture(t);
  await add('b',first,workspace);await add('a',first,workspace);
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace},existing:[{id:'card1',projectId:'p1',threadId:first},{id:'other-card',projectId:'other',threadId:first}]});
  assert.equal(result.candidates.length,1);
  assert.deepEqual(result.candidates[0].existingTaskIds,['card1']);
  assert.equal(result.candidates[0].sourceFiles.length,2);
});

test('conflicting metadata for one id is excluded rather than guessed into a project',async t=>{
  const {sessions,workspace,add}=await fixture(t);
  await add('a',first,workspace);await add('b',first,workspace+'-other');
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace}});
  assert.equal(result.candidates.length,0);
  assert.equal(result.conflictingThreadIds.length,1);
});

test('symlink sources and malformed headers are excluded with incomplete coverage visible',async t=>{
  const {root,sessions,workspace,add}=await fixture(t);
  await add('valid',first,workspace);
  const outside=path.join(root,'outside.jsonl');await writeFile(outside,JSON.stringify({type:'session_meta',payload:{id:second,cwd:workspace}})+'\n');
  await symlink(outside,path.join(sessions,'2026/10/02/linked.jsonl'));
  await writeFile(path.join(sessions,'2026/10/02/broken.jsonl'),'not json\n');
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace}});
  assert.equal(result.candidates.length,1);
  assert.equal(result.complete,false);
  assert.equal(result.excludedFiles,2);
});

test('bounded scan reports truncation instead of claiming complete enumeration',async t=>{
  const {sessions,workspace,add}=await fixture(t);
  await add('a',first,workspace);await add('b',second,workspace);
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace},maxEntries:3});
  assert.equal(result.complete,false);
  assert.equal(result.truncated,true);
});

test('local preview HTTP route rejects caller file scope and never creates a task',async t=>{
  const {createTaskboardServer}=await import('../server/app.mjs');
  const root=await mkdtemp(path.join(os.tmpdir(),'conversation-http-'));
  const sessions=path.join(root,'sessions');await mkdir(sessions);
  const workspace=path.join(root,'project');await mkdir(workspace);
  await writeFile(path.join(sessions,'one.jsonl'),JSON.stringify({type:'session_meta',payload:{id:first,cwd:workspace}})+'\n');
  const app=createTaskboardServer({dataDirectory:path.join(root,'data'),conversationSessionsRoot:sessions});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  app.database.createProject({id:'p1',name:'Synthetic',workspacePath:workspace});
  const address=await app.listen({port:0}),url=`http://127.0.0.1:${address.port}/api/local/conversation-import-preview?projectId=p1`;
  const response=await fetch(url);assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.candidates.length,1);assert.equal(body.saved,false);
  assert.equal(app.database.listTasks({projectId:'p1'}).length,0);
  assert.equal((await fetch(url+'&sessionsRoot=/private')).status,400);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  assert.equal((await fetch(url,{headers:{origin:'https://untrusted.invalid'}})).status,403);
});

test('oversized first lines and aborted discovery fail safely without reading task bodies',async t=>{
  const {sessions,workspace}=await fixture(t);
  await writeFile(path.join(sessions,'2026/10/02/large.jsonl'),'x'.repeat(20000)+'\n');
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace}});
  assert.equal(result.complete,false);assert.equal(result.candidates.length,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace},signal:controller.signal}),{name:'AbortError'});
});

test('conflicts entirely outside the selected project do not disclose their thread ids',async t=>{
  const {sessions,workspace,add}=await fixture(t);
  await add('a',first,workspace);await add('b',second,workspace+'-other');await add('c',second,workspace+'-different');
  const result=await previewProjectConversations({sessionsRoot:sessions,project:{id:'p1',workspacePath:workspace}});
  assert.deepEqual(result.conflictingThreadIds,[]);
  assert.ok(!JSON.stringify(result).includes(second));
  assert.equal(result.candidates.length,1);
});
