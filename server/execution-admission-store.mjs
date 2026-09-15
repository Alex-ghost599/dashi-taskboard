import { randomUUID } from "node:crypto";
import { ExecutionPolicyStore } from "./execution-policy-store.mjs";
import { previewExecutionPolicy } from "./execution-policy.mjs";
const id = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const blocked = (reason) => ({ decision: "blocked", reason, authorizesDispatch: false });
const active = "state IN ('reserved','started','unknown')";

// Durable admission bookkeeping only; a real adapter must still prove task freshness,
// effective permissions and binding. No method in this module dispatches external work.
export class ExecutionAdmissionStore extends ExecutionPolicyStore {
  constructor(filename) {
    super(filename);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      if (this.db.prepare("PRAGMA user_version").get().user_version === 1) this.db.exec(`
        CREATE TABLE admissions(token TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
          semantic_version TEXT NOT NULL, policy_revision INTEGER NOT NULL, request_json TEXT NOT NULL,
          state TEXT NOT NULL, day TEXT NOT NULL, expires_at INTEGER NOT NULL, receipt_id TEXT);
        CREATE UNIQUE INDEX one_active_task ON admissions(task_id) WHERE ${active};
        CREATE TABLE admission_clock(id INTEGER PRIMARY KEY CHECK(id=1), observed_at INTEGER NOT NULL);
        INSERT INTO admission_clock VALUES(1,0);
        PRAGMA user_version=2;`);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); this.close(); throw error; }
  }

  transaction(now, operation) {
    if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - 30000) throw new Error("Invalid timestamp");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const last = this.db.prepare("SELECT observed_at FROM admission_clock WHERE id=1").get().observed_at;
      if (now < last) throw new Error("CLOCK_ROLLBACK");
      this.db.prepare("UPDATE admission_clock SET observed_at=? WHERE id=1").run(now);
      this.db.prepare("UPDATE admissions SET state='cancelled' WHERE state='reserved' AND expires_at<=?").run(now);
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  validate(input, now) {
    if (!input || !id(input.taskId) || !/^[a-f0-9]{64}$/.test(input.semanticInputVersion ?? "")
      || !Number.isSafeInteger(input.policyRevision) || input.policyRevision < 1) return blocked("INVALID_INPUT");
    return previewExecutionPolicy(this.get(input.request?.projectId), input.request, { expectedRevision: input.policyRevision, now });
  }

  limits(projectId, day, policy, exclude = "") {
    const concurrent = this.db.prepare(`SELECT count(*) AS n FROM admissions WHERE project_id=? AND ${active} AND token<>?`).get(projectId, exclude).n;
    if (concurrent >= policy.maxConcurrent) return "CONCURRENCY_LIMIT";
    const daily = this.db.prepare("SELECT count(*) AS n FROM admissions WHERE project_id=? AND day=? AND state<>'cancelled' AND token<>?").get(projectId, day, exclude).n;
    return daily >= policy.maxDispatchesPerDay ? "DAILY_LIMIT" : null;
  }

  reserve(input, now) {
    return this.transaction(now, () => {
      const check = this.validate(input, now);
      if (check.decision === "blocked") return check;
      if (this.db.prepare(`SELECT 1 FROM admissions WHERE task_id=? AND ${active}`).get(input.taskId)) return blocked("TASK_UNRESOLVED");
      const completed = this.db.prepare("SELECT token,receipt_id FROM admissions WHERE task_id=? AND semantic_version=? AND state='finished' ORDER BY rowid DESC LIMIT 1")
        .get(input.taskId, input.semanticInputVersion);
      if (completed) return { decision: "completed", token: completed.token, receiptId: completed.receipt_id, authorizesDispatch: false };
      const day = new Date(now).toISOString().slice(0, 10);
      const policy = this.get(input.request.projectId).policy;
      const reason = this.limits(input.request.projectId, day, policy);
      if (reason) return blocked(reason);
      const token = randomUUID();
      this.db.prepare("INSERT INTO admissions VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(token, input.request.projectId, input.taskId,
        input.semanticInputVersion, input.policyRevision, JSON.stringify(input.request), "reserved", day, now + 30000);
      return { decision: "reserved", token, expiresAt: now + 30000, authorizesDispatch: false };
    });
  }

  start(token, input, now) {
    return this.transaction(now, () => {
      if (this.db.prepare("PRAGMA user_version").get().user_version >= 3) return blocked("ATTEMPT_REQUIRED");
      const row = this.getAdmission(token);
      if (!row || row.state !== "reserved") return blocked("RESERVATION_UNAVAILABLE");
      const reject = (reason) => { this.db.prepare("UPDATE admissions SET state='cancelled' WHERE token=?").run(token); return blocked(reason); };
      const check = this.validate(input, now);
      if (check.decision === "blocked") return reject(check.reason);
      if (row.task_id !== input.taskId || row.semantic_version !== input.semanticInputVersion
        || row.policy_revision !== input.policyRevision || row.request_json !== JSON.stringify(input.request)) return reject("INPUT_CHANGED");
      const day = new Date(now).toISOString().slice(0, 10);
      const reason = this.limits(row.project_id, day, this.get(row.project_id).policy, token);
      if (reason) return reject(reason);
      this.db.prepare("UPDATE admissions SET state='started',day=? WHERE token=?").run(day, token);
      return { decision: "started", token, authorizesDispatch: false };
    });
  }

  markUnknown(token, now) {
    return this.transaction(now, () => this.db.prepare("UPDATE admissions SET state='unknown' WHERE token=? AND state='started'").run(token).changes === 1);
  }

  finish(token, receiptId, now) {
    if (!id(receiptId)) throw new Error("Receipt required");
    return this.transaction(now, () => {
      if (this.db.prepare("PRAGMA user_version").get().user_version >= 3) throw new Error("Attempt receipt required");
      return this.db.prepare("UPDATE admissions SET state='finished',receipt_id=? WHERE token=? AND state='started'").run(receiptId, token).changes === 1;
    });
  }

  getAdmission(token) { return this.db.prepare("SELECT * FROM admissions WHERE token=?").get(token) ?? null; }
}
