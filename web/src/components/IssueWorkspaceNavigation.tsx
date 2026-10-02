import type { IssueWorkspace } from "../issueWorkspace.mjs";
import type { Task } from "../types";
import { useTaskboardI18n } from "../i18n";
import "./IssueWorkspaceNavigation.css";

interface IssueWorkspaceNavigationProps {
  projectName: string;
  workspace: IssueWorkspace;
  tasks: Task[];
  detailTask: Task | null;
  onNavigate: (parentId: string | null) => void;
  onOpenTask: (task: Task) => void;
}

export function IssueWorkspaceNavigation({ projectName, workspace, tasks, detailTask, onNavigate, onOpenTask }: IssueWorkspaceNavigationProps) {
  const { text } = useTaskboardI18n();
  return (
    <nav className="issue-workspace-navigation" aria-label={text("任务工作区导航", "Issue workspace navigation")}>
      <ol className="issue-workspace-breadcrumbs">
        <li><button type="button" onClick={() => onNavigate(null)} aria-current={workspace.state === "root" ? "page" : undefined}>{projectName}</button></li>
        {workspace.breadcrumbs.map((ancestor, index) => (
          <li key={ancestor.id}>
            <span aria-hidden="true">/</span>
            <button type="button" onClick={() => onNavigate(ancestor.id)} aria-current={index === workspace.breadcrumbs.length - 1 ? "page" : undefined}>
              {ancestor.identifier} · {ancestor.title}{ancestor.archivedAt ? text("（已归档）", " (Archived)") : ""}
            </button>
          </li>
        ))}
      </ol>
      <div className="issue-workspace-navigation-actions">
        {workspace.state === "nested" && !workspace.readOnly && (
          <button type="button" className="button secondary" onClick={() => onOpenTask(workspace.parent)}>{text("打开父任务详情", "Open parent issue details")}</button>
        )}
        {detailTask && workspace.state !== "unavailable" && (
          <button type="button" className="button secondary" onClick={() => onNavigate(detailTask.id)}>{text("进入此任务工作区", "Enter this issue workspace")}</button>
        )}
        {!detailTask && tasks.length > 0 && (
          <label>
            <span>{text("子工作区", "Child workspace")}</span>
            <select value="" aria-label={text("打开任务工作区", "Open issue workspace")} onChange={(event) => { if (event.target.value) onNavigate(event.target.value); }}>
              <option value="">{text("选择任务…", "Choose an issue…")}</option>
              {tasks.map((task) => <option key={task.id} value={task.id}>{task.identifier} · {task.title}{task.archivedAt ? text("（已归档）", " (Archived)") : ""}</option>)}
            </select>
          </label>
        )}
      </div>
    </nav>
  );
}
