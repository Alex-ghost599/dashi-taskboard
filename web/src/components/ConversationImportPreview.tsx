import {useEffect,useRef,useState} from 'react';
import {previewProjectConversations,prepareConversationImport,saveConversationImport,discardConversationImport,
  type ConversationSourcePreview,type ConversationImportProposal} from '../api';

export function ConversationImportPreview({projectId,projectName,onSaved}:{projectId:string;projectName?:string;onSaved?:()=>void}) {
  const [opened,setOpened]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const [preview,setPreview]=useState<ConversationSourcePreview|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [includeArchived,setIncludeArchived]=useState(false);
  const [proposal,setProposal]=useState<ConversationImportProposal|null>(null);
  const proposalId=useRef<string|null>(null);
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [receipt,setReceipt]=useState('');
  const pending=useRef(false);
  const generation=useRef(0);
  function releaseProposal() {
    const id=proposalId.current;proposalId.current=null;
    if(id) void discardConversationImport(id).catch(cause=>console.warn('Conversation proposal cleanup failed; bounded expiry remains',cause));
  }
  useEffect(()=>()=>{generation.current++;controller.current?.abort();releaseProposal();},[]);
  async function load() {
    if(pending.current) return;
    releaseProposal();setProposal(null);setReceipt('');
    pending.current=true;setBusy(true);setError('');setPreview(null);
    const request=++generation.current;
    const abort=new AbortController();controller.current=abort;
    try {
      const result=await previewProjectConversations(projectId,{signal:abort.signal,includeArchived});
      if(request===generation.current) setPreview(result);
    } catch(cause) {
      if(request===generation.current) setError(cause instanceof Error?cause.message:'预览失败');
    } finally {
      if(request===generation.current) {pending.current=false;setBusy(false);}
    }
  }
  async function prepare(threadId:string,sourceFile:ConversationSourcePreview['candidates'][number]['sourceFiles'][number]) {
    if(pending.current) return;
    releaseProposal();setProposal(null);setReceipt('');setError('');setBusy(true);pending.current=true;
    const request=++generation.current,abort=new AbortController();controller.current=abort;
    try {
      const result=await prepareConversationImport({projectId,threadId,sourceFile},{signal:abort.signal});
      if(request!==generation.current) {
        void discardConversationImport(result.proposalId).catch(cause=>console.warn('Late proposal cleanup failed',cause));
        return;
      }
      proposalId.current=result.proposalId;setProposal(result);setTitle(result.title);setDescription(result.description);
    } catch(cause) {if(request===generation.current) setError(cause instanceof Error?cause.message:'提案读取失败');}
    finally {if(request===generation.current) {pending.current=false;setBusy(false);}}
  }
  async function save() {
    if(pending.current||!proposal?.canSave||!title.trim()) return;
    const request=++generation.current,abort=new AbortController();controller.current=abort;
    setBusy(true);pending.current=true;setError('');
    try {
      const result=await saveConversationImport({proposalId:proposal.proposalId,title,description},{signal:abort.signal});
      if(request===generation.current) {
        setReceipt(`${result.alreadyImported?'已有卡片':'已保存 Backlog 卡片'}：${result.task.identifier}`);
        setProposal(null);releaseProposal();onSaved?.();
      }
    } catch(cause) {if(request===generation.current) setError(cause instanceof Error?cause.message:'保存失败；可重试获取同一卡片回执');}
    finally {if(request===generation.current) {pending.current=false;setBusy(false);}}
  }
  function clear() {generation.current++;controller.current?.abort();releaseProposal();pending.current=false;setOpened(false);setPreview(null);setProposal(null);setReceipt('');setError('');setBusy(false);}
  return <>
    {!opened&&<button className="button secondary" type="button" onClick={()=>{setOpened(true);void load();}}>预览本项目会话来源</button>}
    {opened&&<div className="delete-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget) clear();}}>
    <section className="delete-dialog conversation-preview-dialog" role="dialog" aria-modal="true" aria-label="会话来源预览" onKeyDown={event=>{if(event.key==='Escape') clear();}}>
    <h2>会话来源预览</h2>
    <p>项目：{projectName??projectId}</p>
    <label><input type="checkbox" checked={includeArchived} disabled={busy} onChange={event=>{releaseProposal();setProposal(null);setReceipt('');setIncludeArchived(event.target.checked);setPreview(null);setError('');}} />包含归档会话（勾选后点击预览）</label>
    <button className="button secondary" type="button" disabled={busy} onClick={()=>void load()}>
      {busy?'读取来源中…':preview||error?'重新预览':'预览本项目会话来源'}
    </button>
    {<button className="button secondary" type="button" onClick={clear}>关闭预览</button>}
    <p>只核对所选本地会话的项目目录与来源 ID。预览不保存任务，不调用模型；状态需人工整理。</p>
    {error&&<p role="alert">{error}</p>}
    {receipt&&<p role="status">{receipt}</p>}
    {proposal&&<section className="conversation-proposal-form" aria-label="待审核卡片提案">
      <p>以下为所选会话的用户原文，需人工整理；状态未知。保存只创建 Backlog 卡片，来源会话不会成为执行绑定。</p>
      {!proposal.canSave&&<p role="alert">提取覆盖不足或没有可用用户原文，不能保存。请缩小来源内容或人工另行整理。</p>}
      <label>卡片标题<input value={title} maxLength={240} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
      <label>卡片说明<textarea value={description} maxLength={100000} disabled={busy} onChange={event=>setDescription(event.target.value)}/></label>
      <details><summary>提案覆盖与来源证据</summary><pre>{JSON.stringify({coverage:proposal.coverage,evidence:proposal.evidence},null,2)}</pre></details>
      <button className="button primary" type="button" disabled={busy||!proposal.canSave||!title.trim()} onClick={()=>void save()}>保存为 Backlog 卡片</button>
    </section>}
    {preview&&<div className="conversation-preview-content">
      <p>匹配目录：<code>{preview.workspacePath}</code></p>
      {!preview.complete&&<p role="alert">覆盖不完整：{preview.truncated?'达到扫描上限；':''}{preview.excludedFiles} 个来源项无法读取，{preview.unavailableSources?.length??0} 个来源根不可用，{preview.conflictingThreadIds.length} 个会话 ID 存在目录冲突。当前列表不能代表全部历史。</p>}
      {preview.complete&&preview.candidates.length===0&&<p>没有匹配的会话来源</p>}
      <ul>{preview.candidates.map(candidate=><li key={candidate.threadId}>
        <code>{candidate.threadId}</code><p>状态未知，需人工整理</p>
        {candidate.existingTaskIds.length>0&&<p>已有任务卡：{candidate.existingTaskIds.join('、')}</p>}
        <details><summary>来源证据</summary><ul>{candidate.sourceFiles.map(source=><li key={`${source.scope??'sessions'}:${source.path}`}>
          <span>{source.scope==='archived_sessions'?'归档':'活动'}：</span><code>{source.path}</code><p>首行 SHA256：{source.headerSha256}</p>
          <button className="button secondary" type="button" disabled={busy} onClick={()=>void prepare(candidate.threadId,source)}>读取此来源并准备卡片</button>
        </li>)}</ul></details>
      </li>)}</ul>
    </div>}
  </section></div>}
  </>;
}
