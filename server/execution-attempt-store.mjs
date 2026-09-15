import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {lstatSync} from 'node:fs';
import {ExecutionAdmissionStore} from './execution-admission-store.mjs';
const blocked=reason=>({decision:'blocked',reason,authorizesDispatch:false});
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value);
const keys=['threadId','codexProjectId','codexProjectKind','codexHostId','workspacePath'];
function validBinding(binding,input) {
  return binding&&typeof binding==='object'&&!Array.isArray(binding)
    &&Object.keys(binding).length===keys.length&&keys.every(key=>Object.hasOwn(binding,key))
    &&id(binding.threadId)&&id(binding.codexProjectId)&&binding.codexProjectKind==='local'
    &&binding.codexHostId==='local'&&binding.codexHostId===input?.request?.hostId
    &&binding.workspacePath===input?.request?.workspacePath;
}

// Bookkeeping for a future trusted adapter. No network calls or model decisions here.
export class ExecutionAttemptStore extends ExecutionAdmissionStore {
  #nativeTaskDatabase = null;

  constructor(filename, { taskDatabasePath = null } = {}) {
    super(filename);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      if(this.db.prepare('PRAGMA user_version').get().user_version===2) this.db.exec(`
        CREATE TABLE execution_attempts(token TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,
          binding_json TEXT NOT NULL,task_version INTEGER NOT NULL,state TEXT NOT NULL,turn_id TEXT);
        CREATE TABLE execution_receipts(receipt_id TEXT PRIMARY KEY,token TEXT NOT NULL,
          receipt_json TEXT NOT NULL,received_at INTEGER NOT NULL);
        PRAGMA user_version=3;`);
      if(this.db.prepare('PRAGMA user_version').get().user_version===3) this.db.exec(`
        CREATE TABLE execution_queue(token TEXT PRIMARY KEY,intent_json TEXT NOT NULL,state TEXT NOT NULL);
        CREATE TABLE execution_worker(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,epoch INTEGER NOT NULL,expires_at INTEGER NOT NULL);
        PRAGMA user_version=4;`);
      if(this.db.prepare('PRAGMA user_version').get().user_version===4) this.db.exec(`
        CREATE TABLE execution_bindings(task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,
          revision INTEGER NOT NULL,binding_json TEXT,changed_at INTEGER NOT NULL);
        PRAGMA user_version=5;`);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');this.close();throw error;}
    if(taskDatabasePath!==null) {
      try {
        if(!path.isAbsolute(taskDatabasePath)||path.resolve(taskDatabasePath)===path.resolve(filename)) throw new Error('Invalid task database path');
        const info=lstatSync(taskDatabasePath);
        if(!info.isFile()||info.isSymbolicLink()) throw new Error('Task database must be a regular file');
        this.db.prepare('ATTACH DATABASE ? AS native_tasks').run(taskDatabasePath);
        this.db.prepare('SELECT t.id,t.project_id,t.version,t.archived_at,t.status,p.workspace_path FROM native_tasks.tasks t JOIN native_tasks.projects p ON p.id=t.project_id LIMIT 0').all();
        this.#nativeTaskDatabase={filename:taskDatabasePath,dev:info.dev,ino:info.ino};
      } catch(error) {this.close();throw error;}
    }
  }

  usesTaskDatabase(filename) {
    if(!this.#nativeTaskDatabase) return false;
    const info=lstatSync(filename);
    return !info.isSymbolicLink()&&info.dev===this.#nativeTaskDatabase.dev&&info.ino===this.#nativeTaskDatabase.ino;
  }

  transaction(now,operation) {
    return super.transaction(now,()=>{
      if(this.#nativeTaskDatabase) {
        const current=lstatSync(this.#nativeTaskDatabase.filename);
        if(current.isSymbolicLink()||current.dev!==this.#nativeTaskDatabase.dev||current.ino!==this.#nativeTaskDatabase.ino) throw new Error('TASK_DATABASE_REPLACED');
      }
      return operation();
    });
  }

  #nativeTaskMatches(taskId,projectId,taskVersion,workspacePath,forExecution=false) {
    if(!this.#nativeTaskDatabase) return true;
    if(!Number.isSafeInteger(taskVersion)||taskVersion<1) return false;
    const task=this.db.prepare('SELECT t.project_id,t.version,t.archived_at,t.status,p.workspace_path FROM native_tasks.tasks t JOIN native_tasks.projects p ON p.id=t.project_id WHERE t.id=?').get(taskId);
    return task&&task.project_id===projectId&&task.version===taskVersion&&task.archived_at===null
      &&(workspacePath===undefined||task.workspace_path===workspacePath)&&(!forExecution||task.status==='todo');
  }

  // Call only after trusted target verification. Task content cannot call this method.
  // Shares the admission transaction: reserved/started/UNKNOWN work prevents rebinding.
  setBinding(taskId,projectId,expectedRevision,binding,now,taskVersion) {
    if(!id(taskId)||!id(projectId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0
      ||(binding!==null&&(!validBinding(binding,{request:{hostId:'local',workspacePath:binding?.workspacePath}})
        ||!path.isAbsolute(binding.workspacePath)||binding.workspacePath.length>4096||binding.workspacePath.includes('\0')))) return blocked('INVALID_BINDING');
    return this.transaction(now,()=>{
      if(!this.#nativeTaskMatches(taskId,projectId,taskVersion,binding?.workspacePath)) return blocked('TASK_CHANGED');
      const current=this.getBinding(taskId);
      if(current.revision!==expectedRevision) return blocked('BINDING_CONFLICT');
      if(this.db.prepare("SELECT 1 FROM admissions WHERE task_id=? AND state IN ('reserved','started','unknown')").get(taskId)) return blocked('TASK_UNRESOLVED');
      const revision=current.revision+1;
      if(!Number.isSafeInteger(revision)) throw new Error('Binding revision exhausted');
      const encoded=binding===null?null:JSON.stringify(Object.fromEntries(keys.map(key=>[key,binding[key]])));
      this.db.prepare('INSERT INTO execution_bindings VALUES(?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET project_id=excluded.project_id,revision=excluded.revision,binding_json=excluded.binding_json,changed_at=excluded.changed_at')
        .run(taskId,projectId,revision,encoded,now);
      return {decision:'bound',...this.getBinding(taskId),authorizesDispatch:false};
    });
  }

  getBinding(taskId) {
    const row=this.db.prepare('SELECT * FROM execution_bindings WHERE task_id=?').get(taskId);
    return row?{taskId,projectId:row.project_id,revision:row.revision,binding:row.binding_json===null?null:JSON.parse(row.binding_json)}
      :{taskId,projectId:null,revision:0,binding:null};
  }

  #bindingMatches(input,binding) {
    const current=this.getBinding(input.taskId);
    return current.projectId===input.request.projectId&&current.binding!==null
      &&current.revision===input.bindingRevision
      &&keys.every(key=>current.binding[key]===binding[key]);
  }

  prepare(token,input,binding,taskVersion,now) {
    if(!validBinding(binding,input)||!Number.isSafeInteger(taskVersion)||taskVersion<1) return blocked('INVALID_BINDING');
    return this.transaction(now,()=>{
      if(this.getQueuedIntent(token)) return blocked('QUEUED_WORKER_REQUIRED');
      return this.#prepare(token,input,binding,taskVersion,now);
    });
  }

  #prepare(token,input,binding,taskVersion,now) {
    const row=this.getAdmission(token);
    if(!row||row.state!=='reserved') return blocked('RESERVATION_UNAVAILABLE');
    if(this.db.prepare("SELECT 1 FROM admissions WHERE state IN ('started','unknown') LIMIT 1").get()) return blocked('GLOBAL_EXECUTOR_BUSY');
    if(!this.#bindingMatches(input,binding)) return blocked('EXECUTION_BINDING_REQUIRED');
    if(!this.#nativeTaskMatches(input.taskId,input.request.projectId,taskVersion,binding.workspacePath,true)) return blocked('TASK_CHANGED');
    const reject=reason=>{this.db.prepare("UPDATE admissions SET state='cancelled' WHERE token=?").run(token);return blocked(reason);};
    const check=this.validate(input,now);
    if(check.decision==='blocked') return reject(check.reason);
    if(!this.#matches(row,input)) return reject('INPUT_CHANGED');
    const day=new Date(now).toISOString().slice(0,10);
    const reason=this.limits(row.project_id,day,this.get(row.project_id).policy,token);
    if(reason) return reject(reason);
    this.db.prepare("UPDATE admissions SET state='started',day=? WHERE token=?").run(day,token);
    const requestId=randomUUID();
    const ordered=Object.fromEntries(keys.map(key=>[key,binding[key]]));
    this.db.prepare('INSERT INTO execution_attempts VALUES(?,?,?,?,?,NULL)').run(token,requestId,JSON.stringify(ordered),taskVersion,'possibly_submitted');
    return {decision:'possibly_submitted',token,requestId,authorizesDispatch:false};
  }

  #matches(row,input) {
    return row.task_id===input.taskId&&row.semantic_version===input.semanticInputVersion
      &&row.policy_revision===input.policyRevision&&row.request_json===JSON.stringify(input.request);
  }

  #intent(input,binding,taskVersion) {
    return JSON.stringify({input,binding:Object.fromEntries(keys.map(key=>[key,binding[key]])),taskVersion});
  }

  // Trusted coordinator only. A queued row is not a dispatch authorization.
  enqueue(token,input,binding,taskVersion,now) {
    if(!validBinding(binding,input)||!Number.isSafeInteger(taskVersion)||taskVersion<1) return blocked('INVALID_BINDING');
    return this.transaction(now,()=>{
      const row=this.getAdmission(token);
      if(!row||row.state!=='reserved') return blocked('RESERVATION_UNAVAILABLE');
      const check=this.validate(input,now);
      if(check.decision==='blocked') return check;
      if(!this.#matches(row,input)) return blocked('INPUT_CHANGED');
      if(!this.#bindingMatches(input,binding)) return blocked('EXECUTION_BINDING_REQUIRED');
      const intent=this.#intent(input,binding,taskVersion),prior=this.getQueuedIntent(token);
      if(prior) return prior.state==='queued'&&prior.intent_json===intent
        ?{decision:'queued',duplicate:true,authorizesDispatch:false}:blocked('QUEUE_CONFLICT');
      this.db.prepare("INSERT INTO execution_queue VALUES(?,?,'queued')").run(token,intent);
      return {decision:'queued',duplicate:false,authorizesDispatch:false};
    });
  }

  // Use a fresh random owner ID per process. Lease expiry allows a new worker,
  // but cannot release or replay a possibly submitted execution attempt.
  acquireWorker(owner,now) {
    if(!id(owner)) return blocked('INVALID_WORKER');
    return this.transaction(now,()=>{
      const prior=this.db.prepare('SELECT * FROM execution_worker WHERE id=1').get();
      if(prior&&prior.expires_at>now) return blocked('WORKER_BUSY');
      const epoch=(prior?.epoch??0)+1;
      if(!Number.isSafeInteger(epoch)) throw new Error('Worker epoch exhausted');
      this.db.prepare('INSERT OR REPLACE INTO execution_worker VALUES(1,?,?,?)').run(owner,epoch,now+30000);
      return {decision:'acquired',owner,epoch,expiresAt:now+30000,authorizesDispatch:false};
    });
  }

  renewWorker(owner,epoch,now) {
    return this.transaction(now,()=>this.db.prepare('UPDATE execution_worker SET expires_at=? WHERE id=1 AND owner=? AND epoch=? AND expires_at>?')
      .run(now+30000,owner,epoch,now).changes===1);
  }

  claimQueued(owner,epoch,token,input,binding,taskVersion,now) {
    if(!validBinding(binding,input)||!Number.isSafeInteger(taskVersion)||taskVersion<1) return blocked('INVALID_BINDING');
    return this.transaction(now,()=>{
      const worker=this.db.prepare('SELECT * FROM execution_worker WHERE id=1').get();
      if(!worker||worker.owner!==owner||worker.epoch!==epoch||worker.expires_at<=now) return blocked('STALE_WORKER');
      const queued=this.getQueuedIntent(token);
      if(!queued||queued.state!=='queued') return blocked('QUEUE_UNAVAILABLE');
      if(queued.intent_json!==this.#intent(input,binding,taskVersion)) return blocked('INTENT_CHANGED');
      const result=this.#prepare(token,input,binding,taskVersion,now);
      if(result.decision==='possibly_submitted') this.db.prepare("UPDATE execution_queue SET state='possibly_submitted' WHERE token=?").run(token);
      else if(this.getAdmission(token)?.state!=='reserved') this.db.prepare("UPDATE execution_queue SET state='cancelled' WHERE token=?").run(token);
      // Only this committed call reports a new attempt. Reads/retries never do.
      // A real adapter still needs identity, permissions and receiver-side fencing.
      return result;
    });
  }

  // Discovery only: reservations may expire between this read and claimQueued.
  pendingIntents(limit=32) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new Error('Queue page limit must be 1..100');
    return this.db.prepare("SELECT q.*,a.expires_at FROM execution_queue q JOIN admissions a ON a.token=q.token WHERE q.state='queued' AND a.state='reserved' ORDER BY q.rowid LIMIT ?").all(limit);
  }

  getQueuedIntent(token) {return this.db.prepare('SELECT * FROM execution_queue WHERE token=?').get(token)??null;}

  markUnknown(token,now) {
    return this.transaction(now,()=>{
      const changed=this.db.prepare("UPDATE admissions SET state='unknown' WHERE token=? AND state='started'").run(token).changes===1;
      if(changed) this.db.prepare("UPDATE execution_attempts SET state='unknown' WHERE token=? AND state<>'finished'").run(token);
      return changed;
    });
  }

  // Only a trusted transport may supply this receipt; never expose it as a task/model API.
  recordReceipt(token,receipt,now) {
    const allowed=['receiptId','requestId','hostId','threadId','turnId','kind'];
    if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||Object.keys(receipt).length!==allowed.length
      ||!allowed.every(key=>Object.hasOwn(receipt,key))||!['accepted','completed'].includes(receipt.kind)
      ||!['receiptId','requestId','hostId','threadId','turnId'].every(key=>id(receipt[key]))) return blocked('INVALID_RECEIPT');
    const normalized=JSON.stringify(Object.fromEntries(allowed.map(key=>[key,receipt[key]])));
    return this.transaction(now,()=>{
      const attempt=this.getAttempt(token);
      if(!attempt) return blocked('ATTEMPT_NOT_FOUND');
      const binding=JSON.parse(attempt.binding_json);
      if(receipt.requestId!==attempt.request_id||receipt.hostId!==binding.codexHostId||receipt.threadId!==binding.threadId
        ||(attempt.turn_id&&receipt.turnId!==attempt.turn_id)) return blocked('RECEIPT_TARGET_MISMATCH');
      const prior=this.db.prepare('SELECT token,receipt_json FROM execution_receipts WHERE receipt_id=?').get(receipt.receiptId);
      if(prior) return prior.token===token&&prior.receipt_json===normalized
        ?{decision:'recorded',duplicate:true,authorizesDispatch:false}:blocked('RECEIPT_CONFLICT');
      this.db.prepare('INSERT INTO execution_receipts VALUES(?,?,?,?)').run(receipt.receiptId,token,normalized,now);
      if(attempt.state!=='finished') {
        if(receipt.kind==='completed') {
          this.db.prepare("UPDATE execution_attempts SET state='finished',turn_id=? WHERE token=?").run(receipt.turnId,token);
          this.db.prepare("UPDATE admissions SET state='finished',receipt_id=? WHERE token=? AND state IN ('started','unknown')").run(receipt.receiptId,token);
        } else {
          // A late acknowledgement proves receipt, not termination; UNKNOWN remains occupied.
          this.db.prepare("UPDATE execution_attempts SET state=CASE WHEN state='unknown' THEN state ELSE 'acknowledged' END,turn_id=? WHERE token=?").run(receipt.turnId,token);
        }
      }
      return {decision:'recorded',duplicate:false,authorizesDispatch:false};
    });
  }

  getAttempt(token) {return this.db.prepare('SELECT * FROM execution_attempts WHERE token=?').get(token)??null;}
}
