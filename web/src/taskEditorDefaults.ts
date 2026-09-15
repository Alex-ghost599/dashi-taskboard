import { TASK_PRIORITIES, type TaskPriority, type DevelopmentScan, type DevelopmentContext } from './types';
import { taskboardStorage } from './storage';

function key(projectId: string, userKey: string) {
  return `taskboard.new-task-defaults.v1.${JSON.stringify([projectId, userKey])}`;
}

export function readTaskEditorDefaults(projectId: string | null, userKey: string, availableLabels: string[]) {
  const empty = { priority: 'none' as TaskPriority, labels: [] as string[] };
  if (!projectId) return empty;
  try {
    const value = JSON.parse(taskboardStorage.getItem(key(projectId, userKey)) ?? 'null');
    if (!value || !TASK_PRIORITIES.includes(value.priority) || !Array.isArray(value.labels)) return empty;
    return { priority: value.priority as TaskPriority,
      labels: [...new Set<string>(value.labels.filter((label: unknown): label is string => typeof label === 'string' && availableLabels.includes(label)))] };
  } catch { return empty; }
}

export function saveTaskEditorDefaults(projectId: string | null, userKey: string, priority: TaskPriority, labels: string[]) {
  if (!projectId) return;
  // A preference storage failure must not turn an already created card into a failed save.
  try { taskboardStorage.setItem(key(projectId, userKey), JSON.stringify({ priority, labels })); } catch { /* Optional preference only. */ }
}

export function currentDevelopmentContext(scan: DevelopmentScan): DevelopmentContext | null {
  const matches = scan.contexts.filter(context => context.type === 'worktree' && context.path === scan.workspacePath);
  if (matches.length !== 1 || matches[0].type !== 'worktree' || !matches[0].branch) return null;
  const branch = matches[0].branch;
  return scan.contexts.find(context => context.type === 'branch' && context.branch === branch) ?? null;
}
