import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {TaskboardDatabase} from '../server/database.mjs';
function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'manual-card-'));
  const database=new TaskboardDatabase(path.join(root,'tasks.sqlite'));
  t.after(()=>{database.close();rmSync(root,{recursive:true,force:true});});
  database.createProject({id:'p1',name:'Synthetic',workspacePath:root});
  const actor={type:'user',id:'tester',name:'Tester',avatarUrl:null};
  const input={projectId:'p1',title:'Synthetic explicit card',description:'',status:'in_progress',priority:'none',labels:[],actor,assignee:actor,threadId:'thread-1',threadBinding:{threadId:'thread-1',codexProjectId:'native-1',codexProjectKind:'local',codexHostId:'local',workspacePath:root},developmentContext:null,startDate:null,dueDate:null,recurrence:null};
  return {database,input,actor};
}
test('retry returns the same manually created card without overwriting later edits',t=>{
  const {database,input,actor}=fixture(t);
  const first=database.createManualConversationTask(input,'request-1');
  database.updateTask(first.id,first.version,{title:'User edited'},null,undefined,actor);
  const retry=database.createManualConversationTask(input,'request-1');
  assert.equal(retry.id,first.id);assert.equal(retry.title,'User edited');
  assert.equal(database.listTasks({projectId:'p1'}).length,1);
  assert.throws(()=>database.createManualConversationTask({...input,title:'Different'},'request-1'),error=>error.code==='MANUAL_REQUEST_CONFLICT');
});
test('revoking the association retains the card and evidence and blocks replay',t=>{
  const {database,input}=fixture(t);
  const task=database.createManualConversationTask(input,'request-1');
  const before=database.getTask(task.id);
  const link=database.revokeManualCardCreation('request-1',task.id);
  assert.ok(link.revokedAt);
  assert.deepEqual(database.getTask(task.id),before);
  assert.deepEqual(link.source,input.threadBinding);
  assert.equal(database.revokeManualCardCreation('request-1',task.id).revokedAt,link.revokedAt);
  assert.throws(()=>database.createManualConversationTask(input,'request-1'),error=>error.code==='MANUAL_CREATION_REVOKED');
  assert.throws(()=>database.revokeManualCardCreation('request-1','different-task'),error=>error.code==='MANUAL_REQUEST_CONFLICT');
});
test('failed card insert leaves no idempotency receipt',t=>{
  const {database,input}=fixture(t);
  assert.throws(()=>database.createManualConversationTask({...input,status:'invalid'},'request-1'));
  assert.equal(database.getManualCardCreation('request-1'),null);
  assert.ok(database.createManualConversationTask(input,'request-1').id);
});

test('current project directory is checked at first creation but replay survives directory changes',t=>{
  const {database,input}=fixture(t);
  const first=database.createManualConversationTask(input,'request-1');
  database.database.prepare('UPDATE projects SET workspace_path=NULL WHERE id=?').run('p1');
  assert.equal(database.createManualConversationTask(input,'request-1').id,first.id);
  assert.throws(()=>database.createManualConversationTask(input,'request-2'),error=>error.code==='MANUAL_SOURCE_CHANGED');
  assert.equal(database.getManualCardCreation('request-2'),null);
});

test('old association revocation cannot clear a later source or execution-related task fields',t=>{
  const {database,input,actor}=fixture(t);
  const task=database.createManualConversationTask(input,'request-1');
  database.updateTask(task.id,task.version,{title:'New work'},'later-thread',undefined,actor);
  const before=database.getTask(task.id);
  const revoked=database.revokeManualCardCreation('request-1',task.id);
  assert.equal(revoked.active,false);assert.equal(revoked.source.threadId,'thread-1');
  assert.deepEqual(database.getTask(task.id),before);
});

test('deleting an archived card retains its receipt and rejects creation replay',t=>{
  const {database,input,actor}=fixture(t);
  const task=database.createManualConversationTask(input,'request-1');
  const archived=database.archiveTask(task.id,task.version,null,undefined,actor);
  database.deleteArchivedTask(task.id,archived.version);
  assert.ok(database.getManualCardCreation('request-1'));
  assert.throws(()=>database.createManualConversationTask(input,'request-1'),error=>error.code==='MANUAL_CREATION_DELETED');
});

test('receipt insertion failure rolls back the new card and project numbering',t=>{
  const {database,input}=fixture(t);
  const before=database.getProject('p1');
  database.database.exec("CREATE TRIGGER reject_manual_receipt BEFORE INSERT ON manual_card_creations BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;");
  assert.throws(()=>database.createManualConversationTask(input,'request-1'),/synthetic receipt failure/);
  assert.equal(database.listTasks({projectId:'p1'}).length,0);
  assert.deepEqual(database.getProject('p1'),before);
});

test('a reopened database reuses the committed receipt',t=>{
  const {database,input}=fixture(t);
  const task=database.createManualConversationTask(input,'request-1');
  const filename=database.database.prepare('PRAGMA database_list').all().find(row=>row.name==='main').file;
  const reopened=new TaskboardDatabase(filename);
  try {
    assert.equal(reopened.createManualConversationTask(input,'request-1').id,task.id);
    assert.equal(reopened.listTasks({projectId:'p1'}).length,1);
  } finally {reopened.close();}
});

test('another manual request for the same active conversation requires an explicit additional-card choice',t=>{
  const {database,input}=fixture(t);
  const first=database.createManualConversationTask(input,'request-1');
  assert.throws(()=>database.createManualConversationTask(input,'request-2'),error=>error.code==='MANUAL_CARD_EXISTS'&&error.details.taskId===first.id);
  assert.equal(database.getManualCardCreation('request-2'),null);
  const additional=database.createManualConversationTask(input,'request-3',{allowAdditional:true});
  assert.notEqual(additional.id,first.id);
  assert.equal(database.createManualConversationTask(input,'request-3',{allowAdditional:true}).id,additional.id);
  assert.throws(()=>database.createManualConversationTask(input,'request-3'),error=>error.code==='MANUAL_REQUEST_CONFLICT');
});
