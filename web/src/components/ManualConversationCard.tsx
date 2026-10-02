import {useEffect, useRef, useState} from "react";
import {ApiError, createManualCard, getTask, listManualCardAssociations, revokeManualCardAssociation, type ManualCardAssociation} from "../api";
import type {Task} from "../types";

export function ManualConversationCard({projectId, onClose, onOpen}: {projectId: string; onClose: () => void; onOpen: (task: Task) => void}) {
  const [threadId, setThreadId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  const request = useRef<{body: string; id: string} | null>(null);
  const submitting = useRef(false);
  async function submit(allowAdditional = false) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const input = {projectId, threadId: threadId.trim(), title: title.trim(), description, allowAdditional};
    const body = JSON.stringify(input);
    if (request.current?.body !== body) request.current = {body, id: crypto.randomUUID()};
    try {
      const result = await createManualCard({...input, requestId: request.current.id});
      onOpen(result.task); onClose();
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "MANUAL_CARD_EXISTS") {
        const details = reason.details as {taskId?: unknown};
        setExistingId(typeof details?.taskId === "string" ? details.taskId : null);
        setError("该会话已有任务卡，可以打开原卡；确有另一项工作时再新建。");
      } else setError(reason instanceof Error ? reason.message : "建卡失败");
    } finally {submitting.current = false; setBusy(false);}
  }
  function changed() {setExistingId(null); setError("");}
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="从 Codex 会话建卡" className="manual-card-dialog">
    <h2>从 Codex 会话建卡</h2>
    <p>核验指定会话后创建进行中卡片并保留来源。不读取对话正文，不绑定执行目标，不发送任务。</p>
    <label>Codex 会话 ID<input disabled={busy} value={threadId} onChange={event => {setThreadId(event.target.value); changed();}} /></label>
    <label>卡片标题<input disabled={busy} maxLength={240} value={title} onChange={event => {setTitle(event.target.value); changed();}} /></label>
    <label>说明<textarea disabled={busy} value={description} onChange={event => {setDescription(event.target.value); changed();}} /></label>
    {error && <p role="alert">{error}</p>}
    {existingId && <button disabled={busy} onClick={() => {setBusy(true); void getTask(existingId).then(task => {onOpen(task); onClose();}).catch(reason => setError(reason.message)).finally(() => setBusy(false));}}>打开已有卡片</button>}
    <button disabled={busy || !threadId.trim() || !title.trim() || Boolean(existingId)} onClick={() => void submit()}>核验来源并创建卡片</button>
    {existingId && <button disabled={busy} onClick={() => void submit(true)}>明确新建另一张卡片</button>}
    <button disabled={busy} onClick={onClose}>取消</button>
  </section></div>;
}

export function ManualCardAssociations({taskId}: {taskId: string}) {
  return <ManualCardAssociationEditor key={taskId} taskId={taskId} />;
}
function ManualCardAssociationEditor({taskId}: {taskId: string}) {
  const [items, setItems] = useState<ManualCardAssociation[]>([]);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setItems([]); setConfirm(null); setError("");
    listManualCardAssociations(taskId).then(rows => {if (active) setItems(rows);}).catch(reason => {if (active) setError(reason.message);});
    return () => {active = false;};
  }, [taskId]);
  if (!items.length && !error) return null;
  return <section className="task-execution-binding" aria-label="手动建卡来源">
    <h3>手动建卡来源</h3>
    {error && <p role="alert">{error}</p>}
    {items.map(item => <div key={item.requestId}>
      <p>{item.source.threadId} · {item.active ? "关联有效" : "关联已撤销（保留来源记录）"}</p>
      <p>{item.source.codexHostId} · {item.source.codexProjectId} · {item.source.workspacePath}</p>
      {item.active && <button disabled={busy} onClick={() => setConfirm(item.requestId)}>撤销此关联</button>}
      {confirm === item.requestId && <>
        <p>仅撤销此建卡关联，保留卡片、来源历史和独立执行绑定。</p>
        <button disabled={busy} onClick={() => {
          setBusy(true); setError("");
          void revokeManualCardAssociation(item.requestId, taskId).then(next => {setItems(rows => rows.map(row => row.requestId === next.requestId ? next : row)); setConfirm(null);}).catch(reason => setError(reason.message)).finally(() => setBusy(false));
        }}>确认撤销关联</button>
        <button disabled={busy} onClick={() => setConfirm(null)}>取消</button>
      </>}
    </div>)}
  </section>;
}
