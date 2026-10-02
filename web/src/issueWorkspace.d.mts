import type { Task } from "./types";

export type IssueWorkspaceBreadcrumb = Pick<Task, "id" | "identifier" | "title" | "archivedAt">;

export type IssueWorkspaceUnavailableCode =
  | "project-required"
  | "parent-not-found"
  | "project-mismatch"
  | "ancestor-not-found"
  | "ancestor-project-mismatch"
  | "parent-cycle"
  | "parent-depth-exceeded";

export type IssueWorkspace = {
  breadcrumbs: IssueWorkspaceBreadcrumb[];
  taskIds: string[];
} & (
  | { state: "root"; parent: null; readOnly: false; code: null }
  | { state: "nested"; parent: Task; readOnly: boolean; code: null }
  | { state: "unavailable"; parent: null; readOnly: true; code: IssueWorkspaceUnavailableCode }
);

export function resolveIssueWorkspace(
  tasks: readonly Task[],
  projectId: string | null,
  parentId: string | null,
): IssueWorkspace;
