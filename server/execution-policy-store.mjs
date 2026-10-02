import { closeSync, existsSync, lstatSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateExecutionPolicy } from "./execution-policy.mjs";

const APPLICATION_ID = 0x44545031;
export class ExecutionPolicyStore {
  constructor(filename, { readOnly = false, createIfMissing = true } = {}) {
    if (!path.isAbsolute(filename)) throw new Error("Policy store path must be absolute");
    this.db = null;
    if (!existsSync(filename) && readOnly) return;
    let created = false;
    if (!readOnly && createIfMissing) {
      try { closeSync(openSync(filename, "wx", 0o600)); created = true; }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Policy store must be a regular file");
    if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) {
      throw new Error("Policy store must be owned by the current user with mode 0600");
    }
    const db = new DatabaseSync(filename, { readOnly });
    try {
      db.exec("PRAGMA busy_timeout=5000");
      if (created) {
        db.exec(`BEGIN IMMEDIATE;
          PRAGMA application_id=${APPLICATION_ID};
          PRAGMA user_version=1;
          CREATE TABLE policy_revisions (
            project_id TEXT NOT NULL, revision INTEGER NOT NULL, policy_json TEXT NOT NULL,
            action TEXT NOT NULL, changed_at TEXT NOT NULL,
            PRIMARY KEY (project_id, revision)
          );
          COMMIT;`);
      }
      if (db.prepare("PRAGMA application_id").get().application_id !== APPLICATION_ID
        || ![1, 2, 3, 4, 5].includes(db.prepare("PRAGMA user_version").get().user_version)) {
        throw new Error("Unrecognized policy store; refusing to modify it");
      }
      this.db = db;
    } catch (error) { db.close(); throw error; }
  }

  get(projectId) {
    if (!this.db) return null;
    const row = this.db.prepare("SELECT * FROM policy_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1").get(projectId);
    return row ? { revision: row.revision, policy: JSON.parse(row.policy_json), action: row.action, changedAt: row.changed_at } : null;
  }

  replace(projectId, expectedRevision, policy) {
    const validated = validateExecutionPolicy(policy);
    if (validated.projectId !== projectId) throw new Error("Policy project differs from selected project");
    return this.update(projectId, expectedRevision, () => validated, "replace");
  }

  pause(projectId, expectedRevision) {
    // Do not resolve workspace paths here: a moved/deleted project must still be pausable.
    const record = this.update(projectId, expectedRevision, (current) => {
      if (!current) throw new Error("No policy exists for this project");
      return { ...current.policy, enabled: false };
    }, "pause");
    return { ...record, runningTasksStopped: false };
  }

  update(projectId, expectedRevision, buildPolicy, action) {
    if (!this.db || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Expected revision is required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(projectId);
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error("STALE_POLICY: read current revision before editing");
      const policy = buildPolicy(current);
      const revision = expectedRevision + 1;
      if (!Number.isSafeInteger(revision)) throw new Error("Policy revision exhausted");
      const changedAt = new Date().toISOString();
      this.db.prepare("INSERT INTO policy_revisions VALUES (?, ?, ?, ?, ?)")
        .run(projectId, revision, JSON.stringify(policy), action, changedAt);
      this.db.exec("COMMIT");
      return { revision, policy, action, changedAt };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close() { this.db?.close(); this.db = null; }
}
