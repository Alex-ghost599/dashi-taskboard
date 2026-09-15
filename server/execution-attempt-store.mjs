import {randomUUID} from 'node:crypto';
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
  constructor(filename) {
    super(filename);
    try {
      this.db.exec('BEGIN IMMEDIATE');
      if(this.db.prepare('PRAGMA user_version').get().user_version===2) this.db.exec(`
        CREATE TABLE execution_attempts(token TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,
          binding_json TEXT NOT NULL,task_version INTEGER NOT NULL,state TEXT NOT NULL,turn_id TEXT);
        CREATE TABLE execution_receipts(receipt_id TEXT PRIMARY KEY,token TEXT NOT NULL,
          receipt_json TEXT NOT NULL,received_at INTEGER NOT NULL);
        PRAGMA user_version=3;`);
      this.db.exec('COMMIT');
    } catch(error) {this.db.exec('ROLLBACK');this.close();throw error;}
  }

  prepare(token,input,binding,taskVersion,now) {
    if(!validBinding(binding,input)||!Number.isSafeInteger(taskVersion)||taskVersion<1) return blocked('INVALID_BINDING');
    return this.transaction(now,()=>{
      const row=this.getAdmission(token);
      if(!row||row.state!=='reserved') return blocked('RESERVATION_UNAVAILABLE');
      // The first managed executor is globally serial, across projects and threads.
      if(this.db.prepare("SELECT 1 FROM admissions WHERE state IN ('started','unknown') LIMIT 1").get()) return blocked('GLOBAL_EXECUTOR_BUSY');
      const reject=reason=>{this.db.prepare("UPDATE admissions SET state='cancelled' WHERE token=?").run(token);return blocked(reason);};
      const check=this.validate(input,now);
      if(check.decision==='blocked') return reject(check.reason);
      if(row.task_id!==input.taskId||row.semantic_version!==input.semanticInputVersion
        ||row.policy_revision!==input.policyRevision||row.request_json!==JSON.stringify(input.request)) return reject('INPUT_CHANGED');
      const day=new Date(now).toISOString().slice(0,10);
      const reason=this.limits(row.project_id,day,this.get(row.project_id).policy,token);
      if(reason) return reject(reason);
      this.db.prepare("UPDATE admissions SET state='started',day=? WHERE token=?").run(day,token);
      const requestId=randomUUID();
      const ordered=Object.fromEntries(keys.map(key=>[key,binding[key]]));
      this.db.prepare('INSERT INTO execution_attempts VALUES(?,?,?,?,?,NULL)').run(token,requestId,JSON.stringify(ordered),taskVersion,'possibly_submitted');
      return {decision:'possibly_submitted',token,requestId,authorizesDispatch:false};
    });
  }

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
