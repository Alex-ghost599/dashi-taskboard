import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const APPLICATION_ID = 0x44544331;
const id = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const response = (status, extra = {}) => ({ status, authorizesDispatch: false, ...extra });

// Private coordinator state only. Never expose these methods to task/model write APIs.
// This leases judgment work; it neither authorizes nor performs Executor dispatch.
export class CandidateStore {
  constructor(filename) {
    this.db = null;
    if (!path.isAbsolute(filename)) throw new Error("Absolute candidate store path required");
    let created = false;
    try { closeSync(openSync(filename, "wx", 0o600)); created = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Candidate store must be a regular file");
    if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) {
      throw new Error("Candidate store requires current-user ownership and mode 0600");
    }
    const db = new DatabaseSync(filename);
    try {
      db.exec("PRAGMA busy_timeout=5000");
      if (created) db.exec(`BEGIN IMMEDIATE;
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
        CREATE TABLE judgment_keys (
          task_id TEXT NOT NULL, judgment_key TEXT NOT NULL, max_attempts INTEGER NOT NULL,
          PRIMARY KEY(task_id, judgment_key)
        );
        CREATE TABLE judgment_attempts (
          token TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
          judgment_key TEXT NOT NULL, auth_rev INTEGER NOT NULL, attempt INTEGER NOT NULL,
          state TEXT NOT NULL, started INTEGER NOT NULL DEFAULT 0,
          lease_until INTEGER NOT NULL, created_at INTEGER NOT NULL,
          receipt_id TEXT, retry_at INTEGER,
          UNIQUE(task_id, judgment_key, attempt)
        );
        CREATE UNIQUE INDEX one_unresolved_judgment ON judgment_attempts(task_id)
          WHERE state IN ('leased', 'unknown');
        CREATE TABLE clock_guard (id INTEGER PRIMARY KEY CHECK(id=1), observed_at INTEGER NOT NULL);
        INSERT INTO clock_guard VALUES (1, 0);
        COMMIT;`);
      if (db.prepare("PRAGMA application_id").get().application_id !== APPLICATION_ID
        || db.prepare("PRAGMA user_version").get().user_version !== 1) throw new Error("Unrecognized candidate store");
      this.db = db;
    } catch (error) { db.close(); throw error; }
  }

  transaction(now, action) {
    if (!this.db || !integer(now)) throw new Error("Valid store and timestamp required");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const observed = this.db.prepare("SELECT observed_at FROM clock_guard WHERE id=1").get().observed_at;
      if (now < observed) throw new Error("CLOCK_MOVED_BACKWARD: wait for clock recovery");
      this.db.prepare("UPDATE clock_guard SET observed_at=? WHERE id=1").run(now);
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  get(token) {
    if (!this.db || !id(token)) throw new Error("Valid attempt token required");
    const row = this.db.prepare("SELECT * FROM judgment_attempts WHERE token=?").get(token);
    return row ? { ...row, started: Boolean(row.started), authorizesDispatch: false } : null;
  }

  claim({ projectId, taskId, judgmentKey, authRev, now, leaseMs, maxAttempts }) {
    if (!id(projectId) || !id(taskId) || typeof judgmentKey !== "string" || !/^[a-f0-9]{64}$/.test(judgmentKey)
      || !integer(authRev) || authRev < 1 || !integer(now)
      || !integer(leaseMs) || leaseMs < 1 || leaseMs > 3_600_000 || !Number.isSafeInteger(now + leaseMs)
      || !integer(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("Invalid claim request");
    return this.transaction(now, () => {
      // A vanished owner after start may already have spent tokens. Expiry must not replay it.
      this.db.prepare(`UPDATE judgment_attempts SET state=CASE WHEN started=1 THEN 'unknown' ELSE 'retryable' END,
        retry_at=? WHERE task_id=? AND state='leased' AND lease_until<=?`).run(now, taskId, now);
      const unresolved = this.db.prepare("SELECT * FROM judgment_attempts WHERE task_id=? AND state IN ('leased','unknown')").get(taskId);
      if (unresolved) return response(unresolved.state === "unknown" ? "unknown" : "busy", { token: unresolved.token });
      const last = this.db.prepare("SELECT * FROM judgment_attempts WHERE task_id=? AND judgment_key=? ORDER BY attempt DESC LIMIT 1").get(taskId, judgmentKey);
      if (last && ["accepted", "rejected"].includes(last.state)) return response("cached", { verdict: last.state, receiptId: last.receipt_id, token: last.token });
      this.db.prepare("INSERT OR IGNORE INTO judgment_keys VALUES (?, ?, ?)").run(taskId, judgmentKey, maxAttempts);
      const limit = this.db.prepare("SELECT max_attempts FROM judgment_keys WHERE task_id=? AND judgment_key=?").get(taskId, judgmentKey).max_attempts;
      if (last && last.attempt >= limit) return response("exhausted");
      if (last && last.retry_at > now) return response("retry_wait", { retryAt: last.retry_at });
      const token = randomUUID();
      const attempt = (last?.attempt ?? 0) + 1;
      this.db.prepare(`INSERT INTO judgment_attempts
        (token, project_id, task_id, judgment_key, auth_rev, attempt, state, lease_until, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'leased', ?, ?)`)
        .run(token, projectId, taskId, judgmentKey, authRev, attempt, now + leaseMs, now);
      return response("leased", { token, attempt, leaseUntil: now + leaseMs });
    });
  }

  active(token, now) {
    const row = this.get(token);
    if (!row || row.state !== "leased" || row.lease_until <= now) throw new Error("STALE_ATTEMPT");
    return row;
  }

  start(token, now) {
    return this.transaction(now, () => {
      const row = this.active(token, now);
      if (row.started) throw new Error("ALREADY_STARTED");
      this.db.prepare("UPDATE judgment_attempts SET started=1 WHERE token=?").run(token);
      return response("started", { token });
    });
  }

  // Only definitive adapter receipts may complete a started attempt. A timeout is unknown,
  // never retryable. retryable is reserved for a known terminal failure with no pending work.
  finish(token, { verdict, receiptId, now, retryAt = null }) {
    if (!["accepted", "rejected", "retryable"].includes(verdict) || !id(receiptId)
      || (verdict === "retryable" && (!integer(retryAt) || retryAt <= now))
      || (verdict !== "retryable" && retryAt !== null)) throw new Error("Invalid judgment receipt");
    return this.transaction(now, () => {
      const row = this.active(token, now);
      if (!row.started) throw new Error("NOT_STARTED");
      this.db.prepare("UPDATE judgment_attempts SET state=?, receipt_id=?, retry_at=? WHERE token=?")
        .run(verdict, receiptId, retryAt, token);
      return response(verdict, { token });
    });
  }

  markUnknown(token, now) {
    return this.transaction(now, () => {
      const row = this.get(token);
      if (!row || row.state !== "leased" || !row.started) throw new Error("STALE_ATTEMPT");
      this.db.prepare("UPDATE judgment_attempts SET state='unknown' WHERE token=?").run(token);
      return response("unknown", { token });
    });
  }

  close() { this.db?.close(); this.db = null; }
}
