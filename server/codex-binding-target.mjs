import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {guardCodexSource,isCodexTarget,requireTrustedCodexFrame} from '../scripts/codex-target-trust.mjs';
import {validatedLoopbackCdpWebSocketUrl} from '../scripts/codex-cdp-pipe.mjs';

const execFileAsync=promisify(execFile);
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function verifyDesktopOwner(port,listeners,table,executable) {
  const lines=listeners.trim().split('\n');
  const addresses=lines.filter(line=>line.startsWith('n')).map(line=>line.slice(1));
  const pids=[...new Set(lines.filter(line=>/^p\d+$/.test(line)).map(line=>line.slice(1)))];
  if(!pids.length||!addresses.length||addresses.some(value=>value!==`127.0.0.1:${port}`&&value!==`[::1]:${port}`)) fail('DESKTOP_UNAVAILABLE');
  const processes=new Map();
  for(const line of table.split('\n')) {
    const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if(match) processes.set(match[1],{parent:match[2],executable:match[3]});
  }
  const owners=pids.filter(pid=>processes.get(pid)?.executable===executable);
  if(owners.length!==1) fail('DESKTOP_UNAVAILABLE');
  for(let pid of pids) {
    const visited=new Set();
    while(pid!==owners[0]&&!visited.has(pid)&&processes.has(pid)) {
      visited.add(pid);pid=processes.get(pid).parent;
    }
    if(pid!==owners[0]) fail('DESKTOP_UNAVAILABLE');
  }
  return owners[0];
}

export function bindingFromDesktopRead({threadId,workspacePath},value) {
  const thread=value?.thread?.thread;
  const assignment=value?.assignments?.[threadId];
  const projectId=assignment?.projectId;
  const project=typeof projectId==='string'?value?.projects?.[projectId]:null;
  if(thread?.id!==threadId||thread.cwd!==workspacePath||!projectId?.trim()
    ||!Array.isArray(project?.rootPaths)||!project.rootPaths.includes(workspacePath)
    ||(assignment.cwd!==undefined&&assignment.cwd!==workspacePath)) fail('TARGET_MISMATCH');
  return {threadId,codexProjectId:projectId,codexProjectKind:'local',codexHostId:'local',workspacePath};
}

// Fixed read operations only. No arbitrary method, dispatch, task creation or token
// is supplied to the renderer. Only native synthetic responses are accepted.
export function desktopReadExpression(threadId,nonce=randomUUID()) {
  return guardCodexSource(`return (async () => {
    const bridge=window.electronBridge;
    if(typeof bridge?.sendMessageFromView!=="function") throw new Error("DESKTOP_UNAVAILABLE");
    const read=(kind,key)=>new Promise((resolve,reject)=>{
      const id=${JSON.stringify(nonce)}+":"+key;
      const finish=(error,value)=>{window.clearTimeout(timer);window.removeEventListener("message",receive,true);error?reject(new Error(error)):resolve(value);};
      const receive=event=>{
        if(event.source!==null||event.origin!=="") return;
        const data=event.data;
        if(kind==="thread") {
          if(data?.type!=="mcp-response"||data.hostId!=="local"||data.message?.id!==id) return;
          event.stopImmediatePropagation();finish(data.message.error?"DESKTOP_UNAVAILABLE":null,data.message.result);
        } else {
          if(data?.type!=="fetch-response"||data.requestId!==id) return;
          event.stopImmediatePropagation();
          if(!Number.isInteger(data.status)||data.status<200||data.status>=300) return finish("DESKTOP_UNAVAILABLE");
          try {finish(null,JSON.parse(data.bodyJsonString).value);} catch {finish("DESKTOP_UNAVAILABLE");}
        }
      };
      const timer=window.setTimeout(()=>finish("DESKTOP_TIMEOUT"),3000);
      window.addEventListener("message",receive,true);
      const message=kind==="thread"
        ?{type:"mcp-request",hostId:"local",request:{id,method:"thread/read",params:{threadId:${JSON.stringify(threadId)},includeTurns:false}},priority:"interactive",source:"taskboard_binding_read",timeoutMs:3000,expiresAtMs:Date.now()+3000}
        :{type:"fetch",requestId:id,method:"POST",url:"vscode://codex/get-global-state",body:JSON.stringify({key})};
      try {Promise.resolve(bridge.sendMessageFromView(message)).catch(()=>finish("DESKTOP_UNAVAILABLE"));} catch {finish("DESKTOP_UNAVAILABLE");}
    });
    const [thread,projects,assignments]=await Promise.all([read("thread","thread"),read("state","local-projects"),read("state","thread-project-assignments")]);
    return {thread,projects,assignments};
  })();`);
}

// A short-lived, abortable CDP channel. Closing rejects every pending operation.
export async function connectBindingCdp(url,signal) {
  signal.throwIfAborted();
  const socket=new WebSocket(url),pending=new Map();let sequence=0;
  let resolveOpen,rejectOpen;
  const opened=new Promise((resolve,reject)=>{resolveOpen=resolve;rejectOpen=reject;});
  const stop=()=>{
    const error=Object.assign(new Error('DESKTOP_UNAVAILABLE'),{code:'DESKTOP_UNAVAILABLE'});
    rejectOpen(error);for(const item of pending.values()) item.reject(error);pending.clear();
    signal.removeEventListener('abort',stop);
    if(socket.readyState<2) socket.close();
  };
  socket.addEventListener('open',()=>resolveOpen(),{once:true});
  socket.addEventListener('error',stop);
  socket.addEventListener('close',stop);
  socket.addEventListener('message',event=>{
    let message;try {message=JSON.parse(String(event.data));} catch {stop();return;}
    const item=pending.get(message.id);if(!item) return;pending.delete(message.id);
    if(message.error) item.reject(Object.assign(new Error('DESKTOP_UNAVAILABLE'),{code:'DESKTOP_UNAVAILABLE'}));else item.resolve(message.result);
  });
  signal.addEventListener('abort',stop,{once:true});
  if(signal.aborted) stop();
  await opened;
  return {close:stop,send(method,params={}) {
    signal.throwIfAborted();
    if(socket.readyState!==1) fail('DESKTOP_UNAVAILABLE');
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      pending.set(id,{resolve,reject});
      try {socket.send(JSON.stringify({id,method,params}));} catch {pending.delete(id);reject(new Error('DESKTOP_UNAVAILABLE'));}
    });
  }};
}

// Explicit server-owned configuration; never discover ports from command lines or
// trust a browser client's host-runtime claims. Attach only, macOS personal mode.
export function createCodexBindingTargetResolver({port,executable}) {
  if(!Number.isInteger(port)||port<1024||port>65535||typeof executable!=='string'||!executable.startsWith('/')) throw new Error('Invalid desktop binding configuration');
  const owner=async signal=>{
    try {
      const [{stdout:listeners},{stdout:table}]=await Promise.all([
        execFileAsync('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-Fpn'],{signal,maxBuffer:1024*1024}),
        execFileAsync('/bin/ps',['-axo','pid=,ppid=,comm='],{signal,maxBuffer:4*1024*1024}),
      ]);
      return verifyDesktopOwner(port,listeners,table,executable);
    } catch {fail('DESKTOP_UNAVAILABLE');}
  };
  return async input=>{
    const signal=AbortSignal.any([input.signal??new AbortController().signal,AbortSignal.timeout(4500)]);
    const pid=await owner(signal);
    const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal,redirect:'error'});
    if(!response.ok) fail('DESKTOP_UNAVAILABLE');
    const targets=await response.json();
    const candidates=Array.isArray(targets)?targets.filter(isCodexTarget):[];
    if(candidates.length!==1) fail('DESKTOP_UNAVAILABLE');
    const url=validatedLoopbackCdpWebSocketUrl(candidates[0].webSocketDebuggerUrl,port);
    const cdp=await connectBindingCdp(url,signal);
    try {
      return await readBindingViaCdp(cdp,input,async()=>await owner(signal)===pid);
    } finally {cdp.close();}
  };
}

export async function readBindingViaCdp(cdp,input,ownerUnchanged) {
  const frame=await requireTrustedCodexFrame(cdp);
  const result=await cdp.send('Runtime.evaluate',{expression:desktopReadExpression(input.threadId),awaitPromise:true,returnByValue:true});
  const fresh=await requireTrustedCodexFrame(cdp);
  if(frame.id!==fresh.id||frame.loaderId!==fresh.loaderId||result.exceptionDetails||!await ownerUnchanged()) fail('DESKTOP_UNAVAILABLE');
  return bindingFromDesktopRead(input,result.result?.value);
}
