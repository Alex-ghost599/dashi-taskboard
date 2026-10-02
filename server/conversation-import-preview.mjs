import {constants} from 'node:fs';
import {open,opendir,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const HEADER_LIMIT=16*1024;
const THREAD_ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

async function readMetadata(file,root,signal,verifyRoot) {
  signal?.throwIfAborted();
  await verifyRoot();
  // Only parse the metadata line; block reads can include discarded body bytes.
  const before=await lstat(file);
  if(await realpath(file)!==file||await realpath(root)!==root) throw new Error('SOURCE_LINK_OR_CHANGED');
  if(!before.isFile()||before.isSymbolicLink()) throw new Error('SOURCE_TYPE');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await handle.stat();
    if(stat.dev!==before.dev||stat.ino!==before.ino) throw new Error('SOURCE_CHANGED');
    // Check the opened descriptor against a path still inside the selected root
    // before reading any bytes; a parent replacement must fail before parsing.
    await verifyRoot();
    if(await realpath(file)!==file||await realpath(root)!==root) throw new Error('SOURCE_LINK_OR_CHANGED');
    const chunks=[];let bytes=0,finished=false;
    while(bytes<HEADER_LIMIT) {
      signal?.throwIfAborted();
      const buffer=Buffer.alloc(Math.min(1024,HEADER_LIMIT-bytes));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
      if(!bytesRead) break;
      const newline=buffer.subarray(0,bytesRead).indexOf(10);
      chunks.push(buffer.subarray(0,newline<0?bytesRead:newline));
      bytes+=bytesRead;
      if(newline>=0) {finished=true;break;}
    }
    if(!finished) throw new Error('HEADER_LIMIT_OR_INCOMPLETE');
    const after=await handle.stat(),current=await lstat(file);
    for(const value of [after,current]) {
      if(stat.dev!==value.dev||stat.ino!==value.ino||stat.size!==value.size||stat.mtimeMs!==value.mtimeMs||stat.ctimeMs!==value.ctimeMs) throw new Error('SOURCE_CHANGED');
    }
    if(await realpath(file)!==file) throw new Error('SOURCE_LINK_OR_CHANGED');
    const header=Buffer.concat(chunks);
    const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(header));
    const meta=record?.payload;
    if(record.type!=='session_meta'||!THREAD_ID.test(meta?.id??'')||typeof meta?.cwd!=='string'||!path.isAbsolute(meta.cwd)) throw new Error('INVALID_METADATA');
    return {threadId:meta.id,workspacePath:path.resolve(meta.cwd),timestamp:typeof meta.timestamp==='string'&&meta.timestamp.length<=64?meta.timestamp:null,
      headerSha256:createHash('sha256').update(header).digest('hex')};
  } finally {await handle.close();}
}

export async function previewProjectConversations({sessionsRoot,archivedSessionsRoot,project,existing=[],maxEntries=10000,signal}) {
  signal?.throwIfAborted();
  if(typeof sessionsRoot!=='string'||!path.isAbsolute(sessionsRoot)||typeof project?.id!=='string'
    ||typeof project.workspacePath!=='string'||!path.isAbsolute(project.workspacePath)
    ||(archivedSessionsRoot!==undefined&&(typeof archivedSessionsRoot!=='string'||!path.isAbsolute(archivedSessionsRoot)))
    ||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>10000||!Array.isArray(existing)) throw new Error('INVALID_PREVIEW_SCOPE');
  const workspace=path.resolve(project.workspacePath);
  let inspectedEntries=0,excludedFiles=0,truncated=false;
  const records=new Map(),unavailableSources=[];
  async function scanSource(selectedRoot,scope) {
    signal?.throwIfAborted();
    const requestedRoot=path.resolve(selectedRoot);
    const rootStat=await lstat(requestedRoot);
    if(rootStat.isSymbolicLink()||!rootStat.isDirectory()) throw new Error('INVALID_SESSIONS_ROOT');
    // Canonicalize the explicitly selected root once (macOS /var is an alias).
    const root=await realpath(requestedRoot);
    const verifyRoot=async()=>{
      const [requested,current]=await Promise.all([lstat(requestedRoot),lstat(root)]);
      for(const value of [requested,current]) {
        if(!value.isDirectory()||value.isSymbolicLink()||value.dev!==rootStat.dev||value.ino!==rootStat.ino) throw new Error('SESSIONS_ROOT_CHANGED');
      }
      if(await realpath(requestedRoot)!==root) throw new Error('SESSIONS_ROOT_CHANGED');
    };
    await verifyRoot();
    async function visit(directory,depth) {
      signal?.throwIfAborted();
      await verifyRoot();
      const entries=await opendir(directory);
      for await(const entry of entries) {
        signal?.throwIfAborted();
        if(inspectedEntries>=maxEntries) {truncated=true;break;}
        inspectedEntries++;
        const file=path.join(directory,entry.name);
        if(entry.isSymbolicLink()) {excludedFiles++;continue;}
        if(entry.isDirectory()) {
          const valid=depth===0?/^20\d{2}$/.test(entry.name):depth===1?/^(0[1-9]|1[0-2])$/.test(entry.name):depth===2?/^(0[1-9]|[12]\d|3[01])$/.test(entry.name):false;
          if(valid) {
            try {
              if(await realpath(file)!==file) throw new Error('SOURCE_CHANGED');
              await visit(file,depth+1);
            } catch {signal?.throwIfAborted();excludedFiles++;}
            if(truncated) break;
          }
          continue;
        }
        if(!entry.name.endsWith('.jsonl')) continue;
        try {
          const metadata=await readMetadata(file,root,signal,verifyRoot);
          const items=records.get(metadata.threadId)??[];
          items.push({...metadata,scope,path:path.relative(root,file)});records.set(metadata.threadId,items);
        } catch {signal?.throwIfAborted();excludedFiles++;}
      }
    }
    await visit(root,0);
    signal?.throwIfAborted();
    await verifyRoot();
    return verifyRoot;
  }
  function excludeArchive(error) {
    signal?.throwIfAborted();
    unavailableSources.push({scope:'archived_sessions',code:error.code??error.message});
    // A failed final identity check invalidates evidence collected from that root.
    for(const [threadId,items] of records) {
      const remaining=items.filter(item=>item.scope!=='archived_sessions');
      if(remaining.length) records.set(threadId,remaining);else records.delete(threadId);
    }
  }
  const verifySessionsRoot=await scanSource(sessionsRoot,'sessions');
  let verifyArchiveRoot;
  if(archivedSessionsRoot!==undefined&&!truncated) {
    try {verifyArchiveRoot=await scanSource(archivedSessionsRoot,'archived_sessions');}
    catch(error) {excludeArchive(error);}
  }
  signal?.throwIfAborted();
  await verifySessionsRoot();
  if(verifyArchiveRoot) {
    try {await verifyArchiveRoot();}
    catch(error) {excludeArchive(error);}
  }
  signal?.throwIfAborted();
  const candidates=[],conflictingThreadIds=[];
  for(const [threadId,items] of records) {
    if(new Set(items.map(item=>item.workspacePath)).size!==1) {
      if(items.some(item=>item.workspacePath===workspace)) conflictingThreadIds.push(threadId);
      continue;
    }
    if(items[0].workspacePath!==workspace) continue;
    const existingTaskIds=existing.filter(task=>task.projectId===project.id
      &&(task.threadId??task.threadBinding?.threadId??task.legacyLocalThreadId)===threadId).map(task=>task.id).sort();
    candidates.push({threadId,projectId:project.id,workspacePath:workspace,status:null,executionBinding:null,
      existingTaskIds:[...new Set(existingTaskIds)],sourceFiles:items.map(item=>({scope:item.scope,path:item.path,headerSha256:item.headerSha256,timestamp:item.timestamp})).sort((a,b)=>a.scope.localeCompare(b.scope)||a.path.localeCompare(b.path))});
  }
  candidates.sort((a,b)=>a.threadId.localeCompare(b.threadId));conflictingThreadIds.sort();
  return {schemaVersion:1,projectId:project.id,workspacePath:workspace,sourceScope:archivedSessionsRoot===undefined?'sessions-only; metadata-first-line':'sessions+archived_sessions; metadata-first-line',
    candidates,conflictingThreadIds,inspectedEntries,excludedFiles,truncated,unavailableSources,
    complete:!truncated&&!excludedFiles&&!conflictingThreadIds.length&&!unavailableSources.length,saved:false,authorizesDispatch:false};
}
