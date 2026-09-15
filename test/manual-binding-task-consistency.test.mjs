import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,renameSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {TaskboardDatabase} from '../server/database.mjs';
import {ManualExecutionBinding} from '../server/manual-execution-binding.mjs';
import {ExecutionAttemptStore} from '../server/execution-attempt-store.mjs';

function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'binding-consistency-'));
  const filename=path.join(root,'tasks.sqlite');
  const tasks=new TaskboardDatabase(filename);
  tasks.createProject({id:'p1',name:'Synthetic',workspacePath:root});
  const actor={type:'user',id:'tester',name:'Tester',avatarUrl:null};
  const task=tasks.createTask({projectId:'p1',title:'Synthetic',description:'',status:'todo',priority:'none',labels:[],actor,assignee:actor,threadId:null,developmentContext:null,startDate:null,dueDate:null,recurrence:null});
  const control=new ExecutionAttemptStore(path.join(root,'control.sqlite'),{taskDatabasePath:filename});
  t.after(()=>{control.close();tasks.close();rmSync(root,{recursive:true,force:true});});
  const binding={threadId:'executor',codexProjectId:'codex-project',codexProjectKind:'local',codexHostId:'local',workspacePath:root};
  return {root,filename,tasks,task,actor,control,binding};
}

test('binding checks current task version, project and directory in its transaction',t=>{
  const {root,tasks,task,actor,control,binding}=fixture(t);
  assert.equal(control.setBinding(task.id,'p1',0,binding,0).reason,'TASK_CHANGED');
  assert.equal(control.setBinding(task.id,'p1',0,{...binding,workspacePath:path.join(root,'other')},1,task.version).reason,'TASK_CHANGED');
  assert.equal(control.setBinding(task.id,'p1',0,binding,2,task.version).decision,'bound');
  const updated=tasks.updateTask(task.id,task.version,{title:'Changed before confirmation'},null,undefined,actor);
  assert.equal(control.setBinding(task.id,'p1',1,null,3,task.version).reason,'TASK_CHANGED');
  assert.equal(control.getBinding(task.id).revision,1);
  assert.equal(control.setBinding(task.id,'p1',1,null,4,updated.version).decision,'bound');
});

test('binding transaction prevents another process modifying the attached task database',t=>{
  const {filename,task,control}=fixture(t);
  const script=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=0');try{db.prepare('UPDATE tasks SET version=version+1 WHERE id=?').run(process.argv[2]);console.log('updated');}catch(e){console.log(e.message);}finally{db.close();}`;
  control.transaction(0,()=>{
    const result=spawnSync(process.execPath,['--input-type=module','-e',script,filename,task.id],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,0);assert.match(result.stdout,/database is locked/);
  });
});

test('task edits after reservation prevent an execution attempt',t=>{
  const {root,tasks,task,actor,control,binding}=fixture(t);
  control.setBinding(task.id,'p1',0,binding,0,task.version);
  control.replace('p1',0,{schemaVersion:1,projectId:'p1',hostId:'local',workspacePath:root,enabled:true,taskCategories:['test'],allowedTools:['read'],maxCallsPerRun:1,maxConcurrent:1,maxDispatchesPerDay:10,expiresAt:'2099-01-01T00:00:00.000Z'});
  const input={taskId:task.id,bindingRevision:1,semanticInputVersion:'a'.repeat(64),policyRevision:1,request:{projectId:'p1',hostId:'local',workspacePath:root,taskCategory:'test',tools:['read'],maxCalls:1}};
  const reservation=control.reserve(input,1000);
  tasks.updateTask(task.id,task.version,{title:'Changed after reservation'},null,undefined,actor);
  assert.equal(control.prepare(reservation.token,input,binding,task.version,1001).reason,'TASK_CHANGED');
  assert.equal(control.getAttempt(reservation.token),null);
});


test('binding transaction leaves task database bytes and task version unchanged',t=>{
  const {filename,tasks,task,control,binding}=fixture(t);
  tasks.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const before=readFileSync(filename);
  assert.equal(control.setBinding(task.id,'p1',0,binding,0,task.version).decision,'bound');
  assert.deepEqual(readFileSync(filename),before);
  assert.equal(tasks.getTask(task.id).version,task.version);
});

test('task database replacement fails without persisting a binding',t=>{
  const {filename,task,control,binding}=fixture(t);
  renameSync(filename,filename+'.original');
  copyFileSync(filename+'.original',filename);
  assert.throws(()=>control.setBinding(task.id,'p1',0,binding,0,task.version),/TASK_DATABASE_REPLACED/);
  assert.equal(control.getBinding(task.id).revision,0);
});


test('preview and confirm are read-only at the desktop and explicit binding never dispatches',async t=>{
  const {tasks,task,control,binding}=fixture(t);let reads=0;
  const service=new ManualExecutionBinding({database:tasks,control,now:()=>1000,resolveTarget:async()=>{reads++;return binding;}});
  const preview=await service.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:0});
  assert.equal(control.getBinding(task.id).binding,null);
  const result=await service.confirm(task.id,preview.previewId);
  assert.equal(result.decision,'bound');assert.equal(result.authorizesDispatch,false);assert.equal(reads,2);
  assert.equal(control.db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n,0);
  await assert.rejects(service.confirm(task.id,preview.previewId),/PREVIEW_UNAVAILABLE/);
  assert.equal(service.unbind(task.id,{taskVersion:task.version,bindingRevision:1}).binding,null);
});

test('target identity drift after preview refuses confirmation',async t=>{
  const {tasks,task,control,binding}=fixture(t);let reads=0;
  const service=new ManualExecutionBinding({database:tasks,control,now:()=>1000,resolveTarget:async()=>({...binding,codexProjectId:reads++?'different-project':binding.codexProjectId})});
  const preview=await service.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:0});
  await assert.rejects(service.confirm(task.id,preview.previewId),/TARGET_CHANGED/);
  assert.equal(control.getBinding(task.id).revision,0);
});

test('unavailable desktop and task changes during preview never save a binding',async t=>{
  const {tasks,task,actor,control,binding}=fixture(t);
  const unavailable=new ManualExecutionBinding({database:tasks,control});
  await assert.rejects(unavailable.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:0}),/DESKTOP_UNAVAILABLE/);
  const service=new ManualExecutionBinding({database:tasks,control,resolveTarget:async()=>{
    tasks.updateTask(task.id,task.version,{title:'Changed while reading target'},null,undefined,actor);return binding;
  }});
  await assert.rejects(service.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:0}),/TASK_CHANGED/);
  assert.equal(control.getBinding(task.id).revision,0);
});


test('clearing project directory still permits inspecting and removing an existing binding',async t=>{
  const {tasks,task,control,binding}=fixture(t);let reads=0;
  const service=new ManualExecutionBinding({database:tasks,control,resolveTarget:async()=>{reads++;return binding;}});
  const preview=await service.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:0});
  await service.confirm(task.id,preview.previewId);
  tasks.database.prepare('UPDATE projects SET workspace_path=NULL WHERE id=?').run('p1');
  assert.deepEqual(service.get(task.id).binding,binding);
  assert.equal(service.unbind(task.id,{taskVersion:task.version,bindingRevision:1}).binding,null);
  assert.equal(reads,2);
  await assert.rejects(service.preview(task.id,{threadId:binding.threadId,taskVersion:task.version,bindingRevision:2}),/PROJECT_UNAVAILABLE/);
});

test('desktop lookups have a shared concurrency bound and release capacity after failure',async t=>{
  const {tasks,task,control,binding}=fixture(t);const pending=[];
  const service=new ManualExecutionBinding({database:tasks,control,resolveTarget:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))});
  const input={threadId:binding.threadId,taskVersion:task.version,bindingRevision:0};
  const running=Array.from({length:4},()=>service.preview(task.id,input));
  const settled=Promise.allSettled(running);
  await assert.rejects(service.preview(task.id,input),/DESKTOP_BUSY/);
  assert.equal(pending.length,4);
  pending[0].reject(new Error('Synthetic failure'));
  for(const item of pending.slice(1)) item.resolve(binding);
  const results=await settled;
  assert.equal(results.filter(item=>item.status==='rejected').length,1);
  const retry=service.preview(task.id,input);
  assert.equal(pending.length,5);pending[4].resolve(binding);
  assert.equal((await retry).target.threadId,binding.threadId);
});

test('manual card creation verifies source once and retries offline without granting execution',async t=>{
  const {tasks,task,actor,control,binding}=fixture(t);let reads=0;
  const service=new ManualExecutionBinding({database:tasks,control,resolveTarget:async()=>{reads++;if(reads>1) throw new Error('offline');return binding;}});
  const input={projectId:task.projectId,title:'Explicit manual card',description:'',status:'in_progress',priority:'none',labels:[],actor,assignee:actor,threadId:binding.threadId,developmentContext:null,startDate:null,dueDate:null,recurrence:null};
  const first=await service.createCard(input,'manual-request');
  assert.equal(first.authorizesDispatch,false);
  assert.equal(control.getBinding(first.task.id).binding,null);
  const retry=await service.createCard(input,'manual-request');
  assert.equal(retry.task.id,first.task.id);assert.equal(reads,1);
  assert.equal(service.revokeCardAssociation('manual-request',first.task.id).association.active,false);
  assert.equal(service.cardAssociation('manual-request').association.active,false);
  await assert.rejects(service.createCard(input,'manual-request'),error=>error.code==='MANUAL_CREATION_REVOKED');
  assert.equal(reads,1);
});
