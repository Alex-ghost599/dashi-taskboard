import { useEffect, useState } from "react";
import { confirmExecutionBinding, getExecutionBinding, previewExecutionBinding, unbindExecutionBinding, type ExecutionBindingPreview, type ExecutionBindingState } from "../api";
import type { Task } from "../types";

// A new key on task/version changes discards stale previews and UI decisions.
export function ExecutionBindingPanel({ task }: { task: Task }) {
  return <BindingEditor key={`${task.id}:${task.version}`} task={task} />;
}
function BindingEditor({ task }: { task: Task }) {
  const [state, setState] = useState<ExecutionBindingState | null>(null);
  const [threadId, setThreadId] = useState("");
  const [preview, setPreview] = useState<ExecutionBindingPreview | null>(null);
  const [detach, setDetach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    getExecutionBinding(task.id).then(value => { if (active) setState(value); }).catch(reason => { if (active) setError(String(reason.message)); });
    return () => { active = false; };
  }, [task.id]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "绑定操作失败"); }
    finally { setBusy(false); }
  }
  const target = preview?.target ?? state?.binding;
  return <section aria-label="执行会话绑定" className="task-execution-binding">
    <h3>执行会话</h3>
    <p>明确绑定执行目标；此操作不发送消息、不启动任务。来源会话另行保留。</p>
    {target ? <dl>
      <dt>会话</dt><dd>{target.threadId}</dd>
      <dt>主机</dt><dd>{target.codexHostId}</dd>
      <dt>Codex 项目</dt><dd>{target.codexProjectId}</dd>
      <dt>目录</dt><dd>{target.workspacePath}</dd>
    </dl> : <p>{state ? "尚未绑定执行会话" : "正在读取绑定状态"}</p>}
    {error && <p role="alert">{error}</p>}
    <label>已有 Codex 会话 ID<input value={threadId} disabled={busy} onChange={event => { setThreadId(event.target.value); setPreview(null); setDetach(false); }} /></label>
    <button type="button" disabled={busy || !state || !threadId.trim()} onClick={() => void perform(async () => {
      setPreview(null); setDetach(false);
      setPreview(await previewExecutionBinding(task.id, threadId.trim(), task.version, state!.revision));
    })}>核验目标</button>
    {preview && <button type="button" disabled={busy || Date.now() >= preview.expiresAt} onClick={() => void perform(async () => {
      const result = await confirmExecutionBinding(task.id, preview.previewId);
      setState(result); setPreview(null);
    })}>确认绑定到以上目标</button>}
    {state?.binding && <button type="button" disabled={busy} onClick={() => { setDetach(true); setPreview(null); }}>解除绑定</button>}
    {detach && <button type="button" disabled={busy} onClick={() => void perform(async () => {
      setState(await unbindExecutionBinding(task.id, task.version, state!.revision)); setDetach(false);
    })}>确认解除执行绑定</button>}
    {(preview || detach) && <button type="button" disabled={busy} onClick={() => { setPreview(null); setDetach(false); }}>取消</button>}
    <button type="button" disabled={busy} onClick={() => void perform(async () => {
      setState(await getExecutionBinding(task.id)); setPreview(null); setDetach(false);
    })}>刷新绑定状态</button>
  </section>;
}
