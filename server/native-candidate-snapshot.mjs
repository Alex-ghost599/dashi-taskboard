import { statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const id = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const TASK_FIELDS = ["id", "project_id", "title", "description", "status", "priority", "labels", "archived_at",
  "assignee_type", "assignee_id", "thread_id", "thread_codex_project_id", "thread_codex_project_kind",
  "thread_codex_host_id", "thread_workspace_path", "git_branch", "worktree_path", "worktree_branch",
  "start_date", "due_date", "recurrence_interval", "recurrence_unit", "external_source"];
const COMMENT_FIELDS = ["id", "body", "author_type", "author_id"];
const ATTACHMENT_FIELDS = ["id", "comment_id", "kind", "filename", "content_type", "size", "change_revision"];

// Uses SQLite's readOnly connection, never the migrating TaskboardDatabase constructor.
export class NativeSnapshotReader {
  #db;
  constructor(filename) {
    if (!path.isAbsolute(filename)) throw new Error("Absolute Taskboard database path required");
    this.filename = filename;
    this.identity = statSync(filename);
    if (!this.identity.isFile()) throw new Error("Taskboard database must be a regular file");
    this.#db = new DatabaseSync(filename, { readOnly: true });
    try { this.#db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=2000;"); }
    catch (error) { this.#db.close(); throw error; }
  }

  read(projectId, judgePolicyRev) {
    if (!id(projectId) || !id(judgePolicyRev)) throw new Error("Invalid snapshot request");
    const current = statSync(this.filename);
    if (current.dev !== this.identity.dev || current.ino !== this.identity.ino) throw new Error("DATABASE_REPLACED");
    this.#db.exec("BEGIN");
    try {
      const project = this.#db.prepare("SELECT CASE WHEN length(workspace_path)<=4096 THEN workspace_path ELSE NULL END AS workspace_path FROM projects WHERE id=?").get(projectId);
      if (!project || typeof project.workspace_path !== "string" || !path.isAbsolute(project.workspace_path)) throw new Error("PROJECT_UNAVAILABLE");
      const todo = this.#db.prepare("SELECT id FROM tasks WHERE project_id=? AND status='todo' AND archived_at IS NULL LIMIT 1001").all(projectId);
      if (todo.length > 1000) throw new Error("SNAPSHOT_LIMIT");
      let remainingCharacters = 2_000_000, remainingRows = 10000, remainingEdges = 20000;
      const boundedRows = (table, fields, where, params) => {
        // Table/column names below are internal constants, never task-provided SQL.
        const sizeExpression = fields.map((field) => `COALESCE(length(${field}),0)`).join("+");
        const size = this.#db.prepare(`SELECT count(*) AS n, COALESCE(sum(${sizeExpression}),0) AS size FROM ${table} WHERE ${where}`).get(...params);
        remainingCharacters -= size.size; remainingRows -= size.n;
        if (remainingCharacters < 0 || remainingRows < 0) throw new Error("SNAPSHOT_LIMIT");
        return this.#db.prepare(`SELECT ${fields.join(",")} FROM ${table} WHERE ${where} ORDER BY id`).all(...params);
      };
      const pending = todo.map((row) => row.id), todoIds = new Set(pending), visited = new Set(), tasks = [];
      while (pending.length) {
        const taskId = pending.pop();
        if (visited.has(taskId)) continue;
        visited.add(taskId);
        if (visited.size > 1000) throw new Error("SNAPSHOT_LIMIT");
        const selected = todoIds.has(taskId);
        const row = boundedRows("tasks", selected ? TASK_FIELDS : ["id", "project_id", "status", "archived_at"], "id=?", [taskId])[0];
        // Preserve a dangling dependency ID so the deterministic guard reports it missing.
        if (!row) continue;
        const dependencies = this.#db.prepare("SELECT DISTINCT source_task_id FROM task_relations WHERE relation_type='blocks' AND target_task_id=? LIMIT 20001").all(taskId).map((item) => item.source_task_id);
        remainingEdges -= dependencies.length;
        if (remainingEdges < 0) throw new Error("SNAPSHOT_LIMIT");
        pending.push(...dependencies);
        if (!selected) {
          tasks.push({ id: row.id, projectId: row.project_id, status: row.status === "canceled" ? "cancelled" : row.status,
            archived: row.archived_at !== null, title: "", description: "", labels: [], executionAgent: null,
            hold: false, executionForbidden: false, dependencyIds: dependencies, executionBinding: null, instructions: [] });
          continue;
        }
        const comments = boundedRows("comments", COMMENT_FIELDS, "task_id=?", [taskId]);
        const attachments = boundedRows("attachments", ATTACHMENT_FIELDS, "task_id=?", [taskId]);
        const labels = JSON.parse(row.labels);
        if (!Array.isArray(labels) || labels.some((label) => typeof label !== "string")) throw new Error("INVALID_LABELS");
        const flags = labels.map((label) => label.trim().toLowerCase());
        let binding = null;
        if (row.thread_id) {
          binding = row.thread_codex_project_id && row.thread_codex_project_kind && row.thread_codex_host_id && row.thread_workspace_path
            ? { threadId: row.thread_id, projectId: row.thread_codex_project_id, hostId: row.thread_codex_host_id, workspacePath: row.thread_workspace_path }
            : { threadId: row.thread_id }; // Deliberately rejected by candidate normalization.
        }
        const metadata = { projectWorkspacePath: project.workspace_path, priority: row.priority, startDate: row.start_date, dueDate: row.due_date,
          branch: row.git_branch, worktreePath: row.worktree_path, worktreeBranch: row.worktree_branch,
          recurrenceInterval: row.recurrence_interval, recurrenceUnit: row.recurrence_unit,
          bindingKind: row.thread_codex_project_kind, source: row.external_source, attachments };
        tasks.push({ id: row.id, projectId: row.project_id, title: row.title, description: row.description,
          status: row.status === "canceled" ? "cancelled" : row.status, archived: row.archived_at !== null,
          executionAgent: row.assignee_type === "agent" && row.assignee_id === "codex-agent" ? "codex" : null,
          labels, hold: flags.includes("hold"), executionForbidden: flags.includes("do-not-execute") || flags.includes("禁止执行"),
          dependencyIds: dependencies, executionBinding: binding,
          instructions: [{ id: "native-task-context", text: JSON.stringify(metadata) }, ...comments.map((comment) => ({
            id: comment.id, text: JSON.stringify({ body: comment.body, authorType: comment.author_type, authorId: comment.author_id }),
          }))] });
      }
      this.#db.exec("COMMIT");
      return { projectIds: [projectId], tasks, unresolvedTaskIds: [], judgePolicyRev };
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  close() { this.#db?.close(); this.#db = null; }
}
