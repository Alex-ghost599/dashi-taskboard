import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createTaskboardServer} from '../server/app.mjs';

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'conversation-proposal-http-'));
  const sessions=path.join(root,'sessions'),workspace=path.join(root,'workspace');
  await mkdir(sessions);await mkdir(workspace);
  const threadId=randomUUID(),file=path.join(sessions,'source.jsonl');
  await writeFile(file,[{type:'session_meta',payload:{id:threadId,cwd:workspace}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic requirement; never execute.'}]}},
    {type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'This is not source user text.'}]}}].map(JSON.stringify).join('\n')+'\n');
  const app=createTaskboardServer({dataDirectory:path.join(root,'data'),conversationSessionsRoot:sessions,
    conversationArchivedSessionsRoot:path.join(root,'archive')});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  app.database.createProject({id:'p1',name:'Synthetic',workspacePath:workspace});
  const address=await app.listen({port:0}),base=`http://127.0.0.1:${address.port}`;
  const preview=await (await fetch(base+'/api/local/conversation-import-preview?projectId=p1')).json();
  const selection={projectId:'p1',threadId,sourceFile:preview.candidates[0].sourceFiles[0]};
  async function post(route,body,headers={}) {
    const response=await fetch(base+'/api/local/'+route,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  }
  return {app,post,selection,file,base};
}

test('explicit HTTP proposal is read-only until reviewed Backlog save, and retry preserves one card',async t=>{
  const {app,post,selection,base}=await fixture(t);
  const prepared=await post('conversation-import-proposal',selection);
  assert.equal(prepared.status,200);
  assert.equal(prepared.body.canSave,true);
  assert.match(prepared.body.description,/Synthetic requirement/);
  assert.doesNotMatch(prepared.body.description,/not source user text/);
  assert.equal(prepared.body.status,'unknown');assert.equal(prepared.body.authorizesDispatch,false);
  assert.equal(app.database.listTasks({projectId:'p1'}).length,0);
  const input={proposalId:prepared.body.proposalId,title:'Reviewed synthetic card',description:prepared.body.description};
  const saved=await post('conversation-import-save',input);
  assert.equal(saved.status,200);assert.equal(saved.body.task.status,'backlog');
  assert.equal(saved.body.task.threadId,null);assert.equal(saved.body.task.threadBinding,null);
  const retry=await post('conversation-import-save',{...input,title:'Retry must not overwrite'});
  assert.equal(retry.status,200);assert.equal(retry.body.task.id,saved.body.task.id);
  assert.equal(retry.body.task.title,input.title);
  assert.equal(app.database.listTasks({projectId:'p1'}).length,1);
  const fresh=await post('conversation-import-proposal',selection);
  const duplicate=await post('conversation-import-save',{...input,proposalId:fresh.body.proposalId});
  assert.equal(duplicate.status,200);assert.equal(duplicate.body.alreadyImported,true);
  assert.equal(duplicate.body.task.id,saved.body.task.id);
  const preview=await (await fetch(base+'/api/local/conversation-import-preview?projectId=p1')).json();
  assert.deepEqual(preview.candidates[0].existingTaskIds,[saved.body.task.id]);
});

test('HTTP proposal and save reject injected fields, actor changes and changed source without cards',async t=>{
  const {app,post,selection,file}=await fixture(t);
  assert.equal((await post('conversation-import-proposal',{...selection,workspacePath:'/untrusted'})).status,400);
  const prepared=await post('conversation-import-proposal',selection);assert.equal(prepared.status,200);
  const input={proposalId:prepared.body.proposalId,title:'Synthetic',description:prepared.body.description};
  assert.equal((await post('conversation-import-save',{...input,status:'todo'})).status,400);
  const stranger=await post('conversation-import-save',input,{'x-taskboard-user-id':'other','x-taskboard-user-name':'Other'});
  assert.equal(stranger.status,403);
  assert.equal((await post('conversation-import-proposal',selection,{origin:'https://untrusted.example'})).status,403);
  assert.equal((await post('conversation-import-discard',{proposalId:prepared.body.proposalId},
    {'x-taskboard-user-id':'other','x-taskboard-user-name':'Other'})).status,403);
  await appendFile(file,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Changed'}]}})+'\n');
  assert.equal((await post('conversation-import-save',input)).status,409);
  assert.equal(app.database.listTasks({projectId:'p1'}).length,0);
});

test('explicit discard invalidates a prepared proposal and never writes a card',async t=>{
  const {app,post,selection}=await fixture(t);
  const prepared=await post('conversation-import-proposal',selection);assert.equal(prepared.status,200);
  assert.equal((await post('conversation-import-discard',{})).status,400);
  const discarded=await post('conversation-import-discard',{proposalId:prepared.body.proposalId});
  assert.equal(discarded.status,200);assert.equal(discarded.body.discarded,true);
  const saved=await post('conversation-import-save',{proposalId:prepared.body.proposalId,title:'Synthetic',description:'No save'});
  assert.equal(saved.status,409);assert.equal(app.database.listTasks({projectId:'p1'}).length,0);
});
