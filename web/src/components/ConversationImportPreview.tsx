import {useEffect,useRef,useState} from 'react';
import {previewProjectConversations,type ConversationSourcePreview} from '../api';

export function ConversationImportPreview({projectId,projectName}:{projectId:string;projectName?:string}) {
  const [opened,setOpened]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const [preview,setPreview]=useState<ConversationSourcePreview|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
  async function load() {
    if(pending.current) return;
    pending.current=true;setBusy(true);setError('');setPreview(null);
    const request=++generation.current;
    const abort=new AbortController();controller.current=abort;
    try {
      const result=await previewProjectConversations(projectId,{signal:abort.signal});
      if(request===generation.current) setPreview(result);
    } catch(cause) {
      if(request===generation.current) setError(cause instanceof Error?cause.message:'预览失败');
    } finally {
      if(request===generation.current) {pending.current=false;setBusy(false);}
    }
  }
  function clear() {generation.current++;controller.current?.abort();pending.current=false;setOpened(false);setPreview(null);setError('');setBusy(false);}
  return <>
    {!opened&&<button className="button secondary" type="button" onClick={()=>{setOpened(true);void load();}}>预览本项目会话来源</button>}
    {opened&&<div className="delete-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget) clear();}}>
    <section className="delete-dialog conversation-preview-dialog" role="dialog" aria-modal="true" aria-label="会话来源预览" onKeyDown={event=>{if(event.key==='Escape') clear();}}>
    <h2>会话来源预览</h2>
    <p>项目：{projectName??projectId}</p>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>void load()}>
      {busy?'读取来源中…':preview||error?'重新预览':'预览本项目会话来源'}
    </button>
    {<button className="button secondary" type="button" onClick={clear}>关闭预览</button>}
    <p>只核对本地活动会话的项目目录与来源 ID。预览不保存任务，不调用模型；状态需人工整理。</p>
    {error&&<p role="alert">{error}</p>}
    {preview&&<div>
      <p>匹配目录：<code>{preview.workspacePath}</code></p>
      {!preview.complete&&<p role="alert">覆盖不完整：{preview.truncated?'达到扫描上限；':''}{preview.excludedFiles} 个来源项无法读取，{preview.conflictingThreadIds.length} 个会话 ID 存在目录冲突。当前列表不能代表全部历史。</p>}
      {preview.complete&&preview.candidates.length===0&&<p>没有匹配的会话来源</p>}
      <ul>{preview.candidates.map(candidate=><li key={candidate.threadId}>
        <code>{candidate.threadId}</code><p>状态未知，需人工整理</p>
        {candidate.existingTaskIds.length>0&&<p>已有任务卡：{candidate.existingTaskIds.join('、')}</p>}
        <details><summary>来源证据</summary><ul>{candidate.sourceFiles.map(source=><li key={source.path}>
          <code>{source.path}</code><p>首行 SHA256：{source.headerSha256}</p>
        </li>)}</ul></details>
      </li>)}</ul>
    </div>}
  </section></div>}
  </>;
}
