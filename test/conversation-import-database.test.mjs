import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TaskboardDatabase} from '../server/database.mjs';
const actor={type:'user',id:'synthetic',name:'Synthetic',avatarUrl:null};
const evidence={projectId:'synthetic',threadId:'11111111-1111-4111-8111-111111111111',workspacePath:'/tmp/synthetic',scope:'sessions',path:'2026/10/02/source.jsonl',headerSha256:'a'.repeat(64),inputSha256:'b'.repeat(64),byteLength:100};
async function fixture(check) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'dashi-import-db-'));
  const filename=path.join(dir,'taskboard.sqlite');
  let database=new TaskboardDatabase(filename);
  try {database.createProject({id:'synthetic',name:'Synthetic',workspacePath:'/tmp/synthetic'});await check(database,()=>{
    const next=new TaskboardDatabase(filename);database.close();database=next;return next;
  });}
  finally {database.close();await rm(dir,{recursive:true,force:true});}
}
function input(title='Manual proposal') {return {projectId:'synthetic',title,description:'Reviewed local excerpt',actor};}
test('import saves evidence with a backlog card and no execution binding',async()=>fixture(async db=>{
  const saved=db.createConversationImportTask(input(),evidence);
  assert.equal(saved.alreadyImported,false);assert.equal(saved.task.status,'backlog');
  assert.equal(saved.task.threadId,null);assert.equal(saved.task.threadBinding,null);
  assert.deepEqual(db.listConversationImports('synthetic')[0].evidence,evidence);
}));
test('same source thread is idempotent and cannot overwrite the first reviewed card',async()=>fixture(async db=>{
  const first=db.createConversationImportTask(input(),evidence);
  const second=db.createConversationImportTask(input('Different text'),{...evidence,inputSha256:'c'.repeat(64)});
  assert.equal(second.alreadyImported,true);assert.equal(second.task.id,first.task.id);
  assert.equal(second.task.title,'Manual proposal');assert.equal(db.listTasks({projectId:'synthetic'}).length,1);
}));
test('provenance insert failure rolls back both task creation and identifier allocation',async()=>fixture(async db=>{
  const before=db.getProject('synthetic');
  db.database.exec("CREATE TRIGGER synthetic_reject_import BEFORE INSERT ON conversation_import_sources BEGIN SELECT RAISE(ABORT,'synthetic evidence failure'); END");
  assert.throws(()=>db.createConversationImportTask(input(),evidence),/synthetic evidence failure/);
  assert.equal(db.listTasks({projectId:'synthetic'}).length,0);
  assert.deepEqual(db.getProject('synthetic'),before);
}));
test('source project mismatch and extra dispatch fields are refused',async()=>fixture(async db=>{
  assert.throws(()=>db.createConversationImportTask(input(),{...evidence,projectId:'other'}));
  assert.throws(()=>db.createConversationImportTask({...input(),status:'todo'},evidence));
  assert.equal(db.listTasks({projectId:'synthetic'}).length,0);
}));
test('source-owned card cannot move to a different project and mislead deduplication',async()=>fixture(async db=>{
  db.createProject({id:'other',name:'Other',workspacePath:'/tmp/other'});
  const {task}=db.createConversationImportTask(input(),evidence);
  assert.throws(()=>db.updateTask(task.id,task.version,{projectId:'other'},null,null,actor),error=>error.code==='CONVERSATION_IMPORT_PROJECT_MOVE_UNAVAILABLE');
  assert.equal(db.getTask(task.id).projectId,'synthetic');
  assert.equal(db.createConversationImportTask(input(),evidence).task.id,task.id);
}));
test('archive preserves deduplication, explicit deletion allows a fresh import',async()=>fixture(async db=>{
  const {task}=db.createConversationImportTask(input(),evidence);
  const archived=db.archiveTask(task.id,task.version,null,null,actor);
  assert.equal(db.createConversationImportTask(input(),evidence).task.id,task.id);
  db.deleteArchivedTask(archived.id,archived.version);
  assert.equal(db.listConversationImports('synthetic').length,0);
  assert.notEqual(db.createConversationImportTask(input(),evidence).task.id,task.id);
}));
test('database reopen preserves source evidence and idempotent saving',async()=>fixture(async(db,reopen)=>{
  const {task}=db.createConversationImportTask(input(),evidence);
  const next=reopen();
  assert.deepEqual(next.listConversationImports('synthetic')[0].evidence,evidence);
  assert.equal(next.createConversationImportTask(input(),evidence).task.id,task.id);
}));
