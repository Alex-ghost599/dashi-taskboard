import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ExecutionAttemptStore} from '../server/execution-attempt-store.mjs';

function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'attempt-'));
  const filename=path.join(root,'control.sqlite');
  const state=new ExecutionAttemptStore(filename);
  t.after(()=>{state.close();rmSync(root,{recursive:true,force:true});});
  const policy={schemaVersion:1,projectId:'p1',hostId:'local',workspacePath:root,enabled:true,taskCategories:['test'],allowedTools:['read'],maxCallsPerRun:1,maxConcurrent:2,maxDispatchesPerDay:10,expiresAt:'2099-01-01T00:00:00.000Z'};
  state.replace('p1',0,policy);
  const input={taskId:'t1',semanticInputVersion:'a'.repeat(64),policyRevision:1,request:{projectId:'p1',hostId:'local',workspacePath:root,taskCategory:'test',tools:['read'],maxCalls:1}};
  const binding={threadId:'thread1',codexProjectId:'codex-project',codexProjectKind:'local',codexHostId:'local',workspacePath:root};
  return {state,filename,input,binding,policy};
}

test('submission intent and admission are atomic and survive reopen without replay',t=>{
  const {state,filename,input,binding}=fixture(t);
  const r=state.reserve(input,1000);
  const attempt=state.prepare(r.token,input,binding,7,1001);
  assert.equal(attempt.decision,'possibly_submitted');
  assert.equal(attempt.authorizesDispatch,false);
  assert.equal(state.getAdmission(r.token).state,'started');
  assert.equal(state.getAttempt(r.token).task_version,7);
  state.close();
  const reopened=new ExecutionAttemptStore(filename);
  try {
    assert.equal(reopened.getAttempt(r.token).request_id,attempt.requestId);
    assert.equal(reopened.prepare(r.token,input,binding,7,1002).reason,'RESERVATION_UNAVAILABLE');
    reopened.markUnknown(r.token,1003);
    assert.equal(reopened.getAttempt(r.token).state,'unknown');
    assert.equal(reopened.reserve(input,100000).reason,'TASK_UNRESOLVED');
  } finally {reopened.close();}
});

test('pause blocks submission and mismatched binding cannot consume admission',t=>{
  const {state,input,binding}=fixture(t);
  const r=state.reserve(input,1000);
  assert.equal(state.prepare(r.token,input,{...binding,codexHostId:'other'},1,1001).reason,'INVALID_BINDING');
  assert.equal(state.getAdmission(r.token).state,'reserved');
  state.pause('p1',1);
  assert.equal(state.prepare(r.token,input,binding,1,1002).reason,'STALE_POLICY');
  assert.equal(state.getAttempt(r.token),null);
});

test('global executor limit spans projects and unknown keeps the slot',t=>{
  const {state,input,binding,policy}=fixture(t);
  state.replace('p2',0,{...policy,projectId:'p2'});
  const second={...input,taskId:'t2',request:{...input.request,projectId:'p2'}};
  const a=state.reserve(input,1000),b=state.reserve(second,1000);
  state.prepare(a.token,input,binding,1,1001);
  assert.equal(state.prepare(b.token,second,{...binding,threadId:'thread2'},1,1002).reason,'GLOBAL_EXECUTOR_BUSY');
  state.markUnknown(a.token,1003);
  assert.equal(state.prepare(b.token,second,binding,1,1004).reason,'GLOBAL_EXECUTOR_BUSY');
  assert.equal(state.getAdmission(a.token).state,'unknown');
});

test('late receipts remain durable after pause; acknowledgement does not free unknown work',t=>{
  const {state,input,binding}=fixture(t);
  const r=state.reserve(input,1000),a=state.prepare(r.token,input,binding,1,1001);
  state.markUnknown(r.token,1002);
  state.pause('p1',1);
  const receipt={receiptId:'ack1',requestId:a.requestId,hostId:'local',threadId:binding.threadId,turnId:'turn1',kind:'accepted'};
  assert.equal(state.recordReceipt(r.token,{...receipt,threadId:'wrong'},1003).reason,'RECEIPT_TARGET_MISMATCH');
  assert.equal(state.recordReceipt(r.token,receipt,1004).decision,'recorded');
  assert.equal(state.getAdmission(r.token).state,'unknown');
  assert.equal(state.getAttempt(r.token).state,'unknown');
  const completed={...receipt,receiptId:'done1',kind:'completed'};
  assert.equal(state.recordReceipt(r.token,completed,1005).authorizesDispatch,false);
  assert.equal(state.getAdmission(r.token).state,'finished');
  assert.equal(state.recordReceipt(r.token,completed,1006).duplicate,true);
  assert.equal(state.recordReceipt(r.token,{...completed,turnId:'wrong'},1007).reason,'RECEIPT_TARGET_MISMATCH');
  assert.equal(state.get('p1').policy.enabled,false);
});

test('schema upgrade refuses old direct start and finish paths',async t=>{
  const {ExecutionAdmissionStore}=await import('../server/execution-admission-store.mjs');
  const {state,filename,input,binding}=fixture(t);
  const r=state.reserve(input,1000);
  const old=new ExecutionAdmissionStore(filename);
  try {
    assert.equal(old.start(r.token,input,1001).reason,'ATTEMPT_REQUIRED');
    state.prepare(r.token,input,binding,1,1001);
    assert.throws(()=>old.finish(r.token,'made-up',1002),/Attempt receipt required/);
  } finally {old.close();}
});

test('attempt insertion failure rolls admission back and there is no public raw start transition',t=>{
  const {state,input,binding}=fixture(t);
  const r=state.reserve(input,1000);
  assert.equal(state.startInTransaction,undefined);
  state.db.exec("CREATE TRIGGER fail_attempt BEFORE INSERT ON execution_attempts BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
  assert.throws(()=>state.prepare(r.token,input,binding,1,1001),/injected write failure/);
  assert.equal(state.getAdmission(r.token).state,'reserved');
  assert.equal(state.getAttempt(r.token),null);
  state.db.exec('DROP TRIGGER fail_attempt');
  assert.equal(state.prepare(r.token,input,binding,1,1002).decision,'possibly_submitted');
});

test('four processes in different projects prepare only one global executor',async t=>{
  const {spawn}=await import('node:child_process');
  const {state,filename,input,binding,policy}=fixture(t);
  const cases=[];
  for(let n=0;n<4;n++) {
    const projectId=`p${n+2}`;
    state.replace(projectId,0,{...policy,projectId});
    const candidate={...input,taskId:`t${n+2}`,request:{...input.request,projectId}};
    cases.push({candidate,token:state.reserve(candidate,1000).token});
  }
  const script=`import {ExecutionAttemptStore} from ${JSON.stringify(new URL('../server/execution-attempt-store.mjs',import.meta.url).href)};
    const s=new ExecutionAttemptStore(process.argv[1]);
    try {console.log(JSON.stringify(s.prepare(process.argv[2],JSON.parse(process.argv[3]),JSON.parse(process.argv[4]),1,1001)));}finally{s.close();}`;
  const results=await Promise.all(cases.map(({candidate,token})=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script,filename,token,JSON.stringify(candidate),JSON.stringify(binding)],{timeout:5000,killSignal:'SIGKILL'});
    let stdout='',stderr='';
    child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(stderr));try{resolve(JSON.parse(stdout));}catch(error){reject(error);}});
  })));
  assert.equal(results.filter(r=>r.decision==='possibly_submitted').length,1);
  assert.equal(results.filter(r=>r.reason==='GLOBAL_EXECUTOR_BUSY').length,3);
  assert.equal(state.db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n,1);
});

test('upgrading a v2 started record retains global occupancy without inventing an attempt',async t=>{
  const {ExecutionAdmissionStore}=await import('../server/execution-admission-store.mjs');
  const {input,binding,policy}=fixture(t);
  const root=mkdtempSync(path.join(tmpdir(),'old-attempt-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const filename=path.join(root,'old.sqlite');
  const old=new ExecutionAdmissionStore(filename);
  old.replace('p1',0,policy);
  const r=old.reserve(input,1000);old.start(r.token,input,1001);old.close();
  const upgraded=new ExecutionAttemptStore(filename);
  try {
    const next={...input,taskId:'t2'};
    const reserve=upgraded.reserve(next,1002);
    assert.equal(upgraded.prepare(reserve.token,next,binding,1,1003).reason,'GLOBAL_EXECUTOR_BUSY');
    assert.equal(upgraded.getAttempt(r.token),null);
    assert.equal(upgraded.getAdmission(r.token).state,'started');
  } finally {upgraded.close();}
});

test('killed submitting process leaves the same durable request and cannot be replayed',async t=>{
  const {spawn}=await import('node:child_process');
  const {state,filename,input,binding}=fixture(t);
  const r=state.reserve(input,1000);
  const script=`import {ExecutionAttemptStore} from ${JSON.stringify(new URL('../server/execution-attempt-store.mjs',import.meta.url).href)};
    const s=new ExecutionAttemptStore(process.argv[1]);
    const result=s.prepare(process.argv[2],JSON.parse(process.argv[3]),JSON.parse(process.argv[4]),1,1001);
    process.send(result);setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,filename,r.token,JSON.stringify(input),JSON.stringify(binding)],{stdio:['ignore','ignore','pipe','ipc'],timeout:5000,killSignal:'SIGKILL'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  let stderr='';child.stderr.on('data',c=>stderr+=c);
  try {
    const result=await new Promise((resolve,reject)=>{
      child.once('message',resolve);child.once('error',reject);
      child.once('exit',()=>reject(new Error(`child exited before prepare receipt: ${stderr}`)));
    });
    assert.equal(result.decision,'possibly_submitted');
    assert.equal(child.kill('SIGKILL'),true);
    const termination=await exited;
    assert.equal(termination.signal,'SIGKILL');
    const reopened=new ExecutionAttemptStore(filename);
    try {
      assert.equal(reopened.getAttempt(r.token).request_id,result.requestId);
      assert.equal(reopened.getAttempt(r.token).state,'possibly_submitted');
      assert.equal(reopened.prepare(r.token,input,binding,1,100000).reason,'RESERVATION_UNAVAILABLE');
      assert.equal(reopened.reserve(input,100000).reason,'TASK_UNRESOLVED');
    } finally {reopened.close();}
  } finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    await exited;
  }
});
