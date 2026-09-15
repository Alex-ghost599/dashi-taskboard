import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ExecutionAttemptStore} from '../server/execution-attempt-store.mjs';
function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'execution-queue-')),filename=path.join(root,'control.sqlite');
  const store=new ExecutionAttemptStore(filename);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  store.replace('p1',0,{schemaVersion:1,projectId:'p1',hostId:'local',workspacePath:root,enabled:true,taskCategories:['test'],allowedTools:['read'],maxCallsPerRun:1,maxConcurrent:2,maxDispatchesPerDay:10,expiresAt:'2099-01-01T00:00:00.000Z'});
  const input={taskId:'t1',semanticInputVersion:'a'.repeat(64),policyRevision:1,request:{projectId:'p1',hostId:'local',workspacePath:root,taskCategory:'test',tools:['read'],maxCalls:1}};
  const binding={threadId:'thread1',codexProjectId:'project1',codexProjectKind:'local',codexHostId:'local',workspacePath:root};
  return {store,filename,input,binding};
}
test('queue duplicate does not extend expiry or create an attempt; only current worker claims once',t=>{
  const {store,input,binding}=fixture(t),r=store.reserve(input,1000);
  assert.equal(store.enqueue(r.token,input,binding,1,1001).decision,'queued');
  assert.equal(store.enqueue(r.token,input,binding,1,1002).duplicate,true);
  assert.equal(store.getAdmission(r.token).expires_at,31000);
  assert.equal(store.getAttempt(r.token),null);
  assert.equal(store.prepare(r.token,input,binding,1,1003).reason,'QUEUED_WORKER_REQUIRED');
  const w=store.acquireWorker('worker1',1004);
  assert.equal(store.acquireWorker('worker1',1005).reason,'WORKER_BUSY');
  assert.equal(store.claimQueued('other',w.epoch,r.token,input,binding,1,1006).reason,'STALE_WORKER');
  const result=store.claimQueued('worker1',w.epoch,r.token,input,binding,1,1007);
  assert.equal(result.decision,'possibly_submitted');assert.equal(result.authorizesDispatch,false);
  assert.equal(store.claimQueued('worker1',w.epoch,r.token,input,binding,1,1008).reason,'QUEUE_UNAVAILABLE');
  assert.equal(store.getAttempt(r.token).request_id,result.requestId);
});
test('a fresh snapshot differing from the queued version or binding is rejected without submission',t=>{
  const {store,input,binding}=fixture(t),r=store.reserve(input,1000),w=store.acquireWorker('w',1000);
  store.enqueue(r.token,input,binding,1,1001);
  assert.equal(store.claimQueued('w',w.epoch,r.token,input,binding,2,1002).reason,'INTENT_CHANGED');
  assert.equal(store.claimQueued('w',w.epoch,r.token,input,{...binding,threadId:'other'},1,1003).reason,'INTENT_CHANGED');
  assert.equal(store.getAttempt(r.token),null);
});
test('pause and reservation expiry prevent queued submission',t=>{
  const {store,input,binding}=fixture(t),w=store.acquireWorker('w',1000),r=store.reserve(input,1000);
  store.enqueue(r.token,input,binding,1,1001);store.pause('p1',1);
  assert.equal(store.claimQueued('w',w.epoch,r.token,input,binding,1,1002).reason,'STALE_POLICY');
  assert.equal(store.getQueuedIntent(r.token).state,'cancelled');assert.equal(store.getAttempt(r.token),null);
});
test('expired queue reservation cannot be renewed by re-enqueue or a new worker',t=>{
  const {store,input,binding}=fixture(t),r=store.reserve(input,1000);
  store.enqueue(r.token,input,binding,1,1001);
  const w=store.acquireWorker('new',32000);
  assert.equal(store.enqueue(r.token,input,binding,1,32001).reason,'RESERVATION_UNAVAILABLE');
  assert.equal(store.claimQueued('new',w.epoch,r.token,input,binding,1,32002).reason,'RESERVATION_UNAVAILABLE');
  assert.equal(store.getAttempt(r.token),null);
});
test('worker takeover fences the old epoch but never releases an existing submitted attempt',t=>{
  const {store,input,binding,filename}=fixture(t),old=store.acquireWorker('old',0),r=store.reserve(input,20000);
  store.enqueue(r.token,input,binding,1,20001);
  const current=store.acquireWorker('new',30001);
  assert.equal(current.epoch,old.epoch+1);
  assert.equal(store.renewWorker('old',old.epoch,30002),false);
  assert.equal(store.claimQueued('old',old.epoch,r.token,input,binding,1,30003).reason,'STALE_WORKER');
  const a=store.claimQueued('new',current.epoch,r.token,input,binding,1,30004);
  store.close();const reopened=new ExecutionAttemptStore(filename);
  try {
    const next=reopened.acquireWorker('next',60002);
    assert.equal(reopened.claimQueued('next',next.epoch,r.token,input,binding,1,60003).reason,'QUEUE_UNAVAILABLE');
    assert.equal(reopened.getAttempt(r.token).request_id,a.requestId);
    assert.equal(reopened.reserve(input,60004).reason,'TASK_UNRESOLVED');
  } finally {reopened.close();}
});
test('queue transition failure rolls back both admission and attempt',t=>{
  const {store,input,binding}=fixture(t),r=store.reserve(input,1000),w=store.acquireWorker('w',1000);
  store.enqueue(r.token,input,binding,1,1001);
  store.db.exec("CREATE TRIGGER fail_queue BEFORE UPDATE ON execution_queue BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.throws(()=>store.claimQueued('w',w.epoch,r.token,input,binding,1,1002),/fixture failure/);
  assert.equal(store.getAdmission(r.token).state,'reserved');assert.equal(store.getAttempt(r.token),null);
  assert.equal(store.getQueuedIntent(r.token).state,'queued');
});
test('four processes compete for one worker and create one attempt',async t=>{
  const {spawn}=await import('node:child_process');
  const {store,filename,input,binding}=fixture(t),r=store.reserve(input,1000);
  store.enqueue(r.token,input,binding,1,1000);
  const script=`import {ExecutionAttemptStore} from ${JSON.stringify(new URL('../server/execution-attempt-store.mjs',import.meta.url).href)};
    const s=new ExecutionAttemptStore(process.argv[1]);
    try {const w=s.acquireWorker(process.argv[5],1001);console.log(JSON.stringify(w.decision==='acquired'?s.claimQueued(w.owner,w.epoch,process.argv[2],JSON.parse(process.argv[3]),JSON.parse(process.argv[4]),1,1001):w));}finally{s.close();}`;
  const results=await Promise.all([0,1,2,3].map(n=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script,filename,r.token,JSON.stringify(input),JSON.stringify(binding),`worker${n}`],{timeout:5000,killSignal:'SIGKILL'});
    let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
    child.on('error',reject);child.on('close',code=>{if(code!==0)return reject(new Error(stderr));try{resolve(JSON.parse(stdout));}catch(e){reject(e);}});
  })));
  assert.equal(results.filter(r=>r.decision==='possibly_submitted').length,1);
  assert.equal(results.filter(r=>r.reason==='WORKER_BUSY').length,3);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n,1);
});
for(const phase of ['queued','submitted']) test(`SIGKILL after ${phase} preserves the correct takeover boundary`,async t=>{
  const {spawn}=await import('node:child_process');
  const {store,filename,input,binding}=fixture(t);
  const script=`import {ExecutionAttemptStore} from ${JSON.stringify(new URL('../server/execution-attempt-store.mjs',import.meta.url).href)};
    const s=new ExecutionAttemptStore(process.argv[1]),input=JSON.parse(process.argv[2]),binding=JSON.parse(process.argv[3]);
    const w=s.acquireWorker('child',0),r=s.reserve(input,20000);s.enqueue(r.token,input,binding,1,20001);
    const result=process.argv[4]==='submitted'?s.claimQueued(w.owner,w.epoch,r.token,input,binding,1,20002):null;
    process.send({token:r.token,result});setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',script,filename,JSON.stringify(input),JSON.stringify(binding),phase],{stdio:['ignore','ignore','pipe','ipc'],timeout:5000,killSignal:'SIGKILL'});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  let stderr='';child.stderr.on('data',c=>stderr+=c);
  try {
    const receipt=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error(`premature exit: ${stderr}`)));});
    assert.equal(child.kill('SIGKILL'),true);assert.equal((await exited).signal,'SIGKILL');
    const w=store.acquireWorker('replacement',30001);
    assert.equal(w.decision,'acquired');
    const claimed=store.claimQueued(w.owner,w.epoch,receipt.token,input,binding,1,30002);
    if(phase==='queued') assert.equal(claimed.decision,'possibly_submitted');
    else {assert.equal(claimed.reason,'QUEUE_UNAVAILABLE');assert.equal(store.getAttempt(receipt.token).request_id,receipt.result.requestId);}
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM execution_attempts').get().n,1);
  } finally {if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL');await exited;}
});
test('renewal extends only the live epoch; reusing an owner after expiry produces a new epoch',t=>{
  const {store}=fixture(t),w=store.acquireWorker('same',0);
  assert.equal(store.renewWorker(w.owner,w.epoch,20000),true);
  assert.equal(store.acquireWorker('other',30001).reason,'WORKER_BUSY');
  const next=store.acquireWorker('same',50000);assert.equal(next.epoch,w.epoch+1);
  assert.equal(store.renewWorker(w.owner,w.epoch,50001),false);
  assert.equal(store.renewWorker(next.owner,next.epoch,50002),true);
});
test('schema3 in-flight attempt survives upgrade and still occupies the global slot',t=>{
  const {store,filename,input,binding}=fixture(t),r=store.reserve(input,1000),a=store.prepare(r.token,input,binding,1,1001);
  // Exact schema3 layout: the two queue tables were its only schema4 additions.
  store.db.exec('DROP TABLE execution_queue; DROP TABLE execution_worker; PRAGMA user_version=3;');store.close();
  const upgraded=new ExecutionAttemptStore(filename);
  try {
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version,4);
    assert.equal(upgraded.getAttempt(r.token).request_id,a.requestId);
    const input2={...input,taskId:'t2'},r2=upgraded.reserve(input2,1002),w=upgraded.acquireWorker('w',1003);
    upgraded.enqueue(r2.token,input2,binding,1,1004);
    assert.equal(upgraded.claimQueued(w.owner,w.epoch,r2.token,input2,binding,1,1005).reason,'GLOBAL_EXECUTOR_BUSY');
  } finally {upgraded.close();}
});
test('queue discovery is bounded and cannot surface already submitted records for replay',t=>{
  const {store,input,binding}=fixture(t),r=store.reserve(input,1000);
  store.enqueue(r.token,input,binding,1,1001);
  assert.equal(store.pendingIntents(1)[0].token,r.token);
  assert.throws(()=>store.pendingIntents(101),/limit/);
  const w=store.acquireWorker('w',1002);store.claimQueued(w.owner,w.epoch,r.token,input,binding,1,1003);
  assert.deepEqual(store.pendingIntents(),[]);
});
