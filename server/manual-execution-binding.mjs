import {randomUUID} from 'node:crypto';

const fields=['threadId','codexProjectId','codexProjectKind','codexHostId','workspacePath'];
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
const equal=(left,right)=>fields.every(key=>left[key]===right[key]);

// resolveTarget is a trusted, read-only desktop adapter. Client host-runtime reports
// and task/model text are never target verification. No method dispatches work.
export class ManualExecutionBinding {
  #previews=new Map();
  #inflight=0;
  constructor({database,control,resolveTarget,now=Date.now}) {
    const taskFile=database.database.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
    if(!taskFile||!control.usesTaskDatabase(taskFile)) fail('TASK_COORDINATION_REQUIRED');
    this.database=database;this.control=control;this.resolveTarget=resolveTarget;this.now=now;
  }
  #task(taskId,requireWorkspace=false) {
    const task=this.database.getTask(taskId);
    if(!task||task.archivedAt!==null) fail('TASK_UNAVAILABLE');
    const project=this.database.getProject(task.projectId);
    if(requireWorkspace&&!project?.workspacePath) fail('PROJECT_UNAVAILABLE');
    return {task,project};
  }
  #prune() {
    const now=this.now();
    for(const [id,item] of this.#previews) if(item.expiresAt<=now) this.#previews.delete(id);
  }
  async #resolve(threadId,project) {
    if(typeof threadId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(threadId)) fail('INVALID_THREAD');
    if(typeof this.resolveTarget!=='function') fail('DESKTOP_UNAVAILABLE');
    if(this.#inflight>=4) fail('DESKTOP_BUSY');
    this.#inflight++;
    const controller=new AbortController();
    let timer;
    try {
      const result=await Promise.race([
        this.resolveTarget({threadId,workspacePath:project.workspacePath,signal:controller.signal}),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('DESKTOP_TIMEOUT'),{code:'DESKTOP_TIMEOUT'}));},5000);}),
      ]);
      if(!result||result.threadId!==threadId||result.codexHostId!=='local'||result.codexProjectKind!=='local'
        ||typeof result.codexProjectId!=='string'||!result.codexProjectId.trim()
        ||result.workspacePath!==project.workspacePath) fail('TARGET_MISMATCH');
      return Object.fromEntries(fields.map(key=>[key,result[key]]));
    } finally {clearTimeout(timer);controller.abort();this.#inflight--;}
  }
  async createCard(input,requestId,{allowAdditional=false}={}) {
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(requestId)) fail('INVALID_MANUAL_REQUEST');
    const existing=this.database.getManualCardCreation(requestId);
    let source=existing?.source;
    if(!existing) {
      const project=this.database.getProject(input.projectId);
      if(!project?.workspacePath) fail('PROJECT_UNAVAILABLE');
      source=await this.#resolve(input.threadId,project);
    }
    const {task,created}=this.database.createManualConversationTask({...input,threadBinding:source},requestId,{allowAdditional,withOutcome:true});
    return {task,created,association:this.database.getManualCardCreation(requestId),authorizesDispatch:false};
  }
  cardAssociation(requestId) {
    const association=this.database.getManualCardCreation(requestId);
    if(!association) fail('MANUAL_ASSOCIATION_UNAVAILABLE');
    return {association,taskExists:Boolean(this.database.getTask(association.taskId)),authorizesDispatch:false};
  }
  revokeCardAssociation(requestId,taskId) {
    return {association:this.database.revokeManualCardCreation(requestId,taskId),authorizesDispatch:false};
  }
  get(taskId) {
    const {task}=this.#task(taskId);
    return {...this.control.getBinding(task.id),taskVersion:task.version,authorizesDispatch:false};
  }
  async preview(taskId,{threadId,taskVersion,bindingRevision}) {
    this.#prune();
    if(this.#previews.size>=64) fail('PREVIEW_LIMIT');
    const {task,project}=this.#task(taskId,true);
    if(task.version!==taskVersion||this.control.getBinding(task.id).revision!==bindingRevision) fail('TASK_CHANGED');
    const target=await this.#resolve(threadId,project);
    const fresh=this.#task(task.id,true);
    if(fresh.task.version!==task.version||fresh.task.projectId!==task.projectId
      ||fresh.project.workspacePath!==project.workspacePath||this.control.getBinding(task.id).revision!==bindingRevision) fail('TASK_CHANGED');
    this.#prune();
    if(this.#previews.size>=64) fail('PREVIEW_LIMIT');
    const previewId=randomUUID(),expiresAt=this.now()+30000;
    const record={previewId,taskId:task.id,projectId:task.projectId,taskVersion,bindingRevision,target,expiresAt};
    this.#previews.set(previewId,record);
    return {...structuredClone(record),authorizesDispatch:false};
  }
  async confirm(taskId,previewId) {
    this.#prune();
    const record=this.#previews.get(previewId);
    if(!record||record.taskId!==taskId) fail('PREVIEW_UNAVAILABLE');
    // Consume before awaiting: duplicate confirmations cannot race or silently replay.
    this.#previews.delete(previewId);
    const {task,project}=this.#task(taskId,true);
    if(task.version!==record.taskVersion||task.projectId!==record.projectId) fail('TASK_CHANGED');
    const target=await this.#resolve(record.target.threadId,project);
    if(this.now()>=record.expiresAt) fail('PREVIEW_EXPIRED');
    if(!equal(target,record.target)) fail('TARGET_CHANGED');
    return this.control.setBinding(task.id,task.projectId,record.bindingRevision,target,this.now(),record.taskVersion);
  }
  unbind(taskId,{taskVersion,bindingRevision}) {
    const {task}=this.#task(taskId);
    return this.control.setBinding(task.id,task.projectId,bindingRevision,null,this.now(),taskVersion);
  }
}
