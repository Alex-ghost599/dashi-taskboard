import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { previewObsImport } from "../shared/obs-import-preview.mjs";
const APP_ID = 0x4f425349;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const flags = { authorizesSourceWrite: false, authorizesImport: false, authorizesDispatch: false };
const safePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096
  && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/")
  && !/^[A-Za-z]:/.test(value) && value.split("/").every((part) => part && part !== "." && part !== "..");

// Derived observations only, in a dedicated private file. No source writes,
// scheduler, model calls or access to the native task/control databases.
export class ObsReadonlyIndex {
  constructor(filename, sourceRoot, { readOnly = false } = {}) {
    this.db = null;
    if (!path.isAbsolute(filename) || typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot) || sourceRoot.includes("\0")) throw new Error("ABSOLUTE_PATH_REQUIRED");
    const parent = lstatSync(path.dirname(filename));
    if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== "win32"
      && ((parent.mode & 0o077) || parent.uid !== process.getuid()))) throw new Error("PRIVATE_PARENT_REQUIRED");
    let created = false;
    if (!readOnly) {
      try { closeSync(openSync(filename, "wx", 0o600)); created = true; } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== "win32"
      && ((info.mode & 0o077) || info.uid !== process.getuid()))) throw new Error("PRIVATE_FILE_REQUIRED");
    const db = new DatabaseSync(filename, { readOnly });
    try {
      db.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL");
      if (created) {
        db.exec(`BEGIN IMMEDIATE;
          PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;
          CREATE TABLE meta(id INTEGER PRIMARY KEY CHECK(id=1), root TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE versions(hash TEXT PRIMARY KEY, markdown TEXT NOT NULL, bytes INTEGER NOT NULL);
          CREATE TABLE documents(path TEXT PRIMARY KEY, task_id TEXT, hash TEXT NOT NULL, revision INTEGER NOT NULL, summary TEXT NOT NULL);
          CREATE TABLE identities(path TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(path,task_id));
          CREATE TABLE operations(id TEXT PRIMARY KEY, digest TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE observations(operation_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(operation_id,path));`);
        db.prepare("INSERT INTO meta VALUES(1,?,0)").run(sourceRoot);
        db.exec("COMMIT");
      }
      if (db.prepare("PRAGMA application_id").get().application_id !== APP_ID || db.prepare("PRAGMA user_version").get().user_version !== 1) throw new Error("UNRECOGNIZED_INDEX");
      if (db.prepare("SELECT root FROM meta WHERE id=1").get().root !== sourceRoot) throw new Error("ROOT_MISMATCH");
      this.db = db;
    } catch (error) { db.close(); throw error; }
  }

  apply({ operationId, expectedRevision, snapshot }) {
    if (typeof operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(operationId)
      || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision === Number.MAX_SAFE_INTEGER) throw new Error("INVALID_OPERATION");
    if (!snapshot || !Array.isArray(snapshot.documents) || !snapshot.documents.every((doc) => doc && safePath(doc.path)
      && typeof doc.markdown === "string" && Buffer.byteLength(doc.markdown) <= 1024 * 1024)) throw new Error("INVALID_DOCUMENTS");
    if (new Set(snapshot.documents.map((doc) => doc.path)).size !== snapshot.documents.length) throw new Error("DUPLICATE_SOURCE_PATH");
    const report = previewObsImport({ ...snapshot, existing: [] });
    const digest = hash(JSON.stringify({ expectedRevision, documents: snapshot.documents.map(({ path, markdown }) => ({ path, markdown })),
      projects: snapshot.projects.map(({ hostId, projectId, workspacePath }) => ({ hostId, projectId, workspacePath })),
      scope: { from: snapshot.scope.from, through: snapshot.scope.through, statuses: snapshot.scope.statuses } }));
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = db.prepare("SELECT * FROM operations WHERE id=?").get(operationId);
      if (previous) {
        if (previous.digest !== digest) throw new Error("OPERATION_CONFLICT");
        db.exec("COMMIT");
        return { revision: previous.revision, duplicate: true, ...flags };
      }
      const current = db.prepare("SELECT revision FROM meta WHERE id=1").get().revision;
      if (current !== expectedRevision) throw new Error("STALE_REVISION");
      const revision = current + 1;
      const counts = db.prepare("SELECT (SELECT count(*) FROM operations) AS ops,(SELECT count(*) FROM observations) AS observations").get();
      if (counts.ops >= 10000 || counts.observations + snapshot.documents.length > 100000) throw new Error("INDEX_CAPACITY");
      for (let i = 0; i < snapshot.documents.length; i++) {
        const doc = snapshot.documents[i], row = report.rows[i];
        const contentHash = hash(doc.markdown);
        const old = db.prepare("SELECT * FROM documents WHERE path=?").get(doc.path);
        let reason = row.reason ?? null;
        if (old?.task_id && row.taskId && old.task_id !== row.taskId) reason = "SOURCE_ID_CHANGED";
        if (old && old.hash !== contentHash && db.prepare("SELECT 1 FROM observations WHERE path=? AND hash=? LIMIT 1").get(doc.path, contentHash)) reason = "HISTORICAL_CONTENT_REAPPEARED";
        // Identity/history conflicts need explicit reconciliation; observing the
        // same or another version cannot prove that the conflict was resolved.
        const previousReason = old ? JSON.parse(old.summary).reason : null;
        if (["SOURCE_ID_CHANGED", "HISTORICAL_CONTENT_REAPPEARED"].includes(previousReason)) reason = previousReason;
        const taskId = old?.task_id ?? row.taskId;
        if (row.taskId) db.prepare("INSERT OR IGNORE INTO identities VALUES(?,?)").run(doc.path, row.taskId);
        const summary = JSON.stringify({ taskId, observedTaskId: row.taskId, reason,
          state: reason || row.decision !== "candidate" ? "blocked" : "observed",
          sourceStatus: row.proposed?.sourceStatus ?? null, projectBinding: row.proposed?.projectBinding ?? null,
          sourceSession: row.proposed?.sourceSession ?? null, executionBinding: row.proposed?.executionBinding ?? null,
          bindingVerified: false });
        if (row.decision === "candidate") db.prepare("INSERT OR IGNORE INTO versions VALUES(?,?,?)").run(contentHash, doc.markdown, Buffer.byteLength(doc.markdown));
        db.prepare("INSERT INTO documents VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET task_id=excluded.task_id,hash=excluded.hash,revision=excluded.revision,summary=excluded.summary")
          .run(doc.path, taskId, contentHash, revision, summary);
        db.prepare("INSERT INTO observations VALUES(?,?,?,?)").run(operationId, doc.path, contentHash, summary);
      }
      if (db.prepare("SELECT count(*) AS n FROM documents").get().n > 1000
        || db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM versions").get().n > 128 * 1024 * 1024) throw new Error("INDEX_CAPACITY");
      db.prepare("INSERT INTO operations VALUES(?,?,?)").run(operationId, digest, revision);
      db.prepare("UPDATE meta SET revision=? WHERE id=1").run(revision);
      db.exec("COMMIT");
      return { revision, duplicate: false, ...flags };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  list() {
    const db = this.db;
    db.exec("BEGIN");
    try {
      const { revision, root } = db.prepare("SELECT * FROM meta WHERE id=1").get();
      const rows = db.prepare("SELECT * FROM documents ORDER BY path").all();
      // Retain every observed identity/path association, including replaced IDs.
      // A missing path or subsequent edit cannot prove a duplicate was resolved.
      const conflictingPaths = new Set(db.prepare(`SELECT DISTINCT path FROM identities WHERE task_id IN
        (SELECT task_id FROM identities GROUP BY task_id HAVING count(*) > 1)`).all().map((row) => row.path));
      const items = rows.map((row) => {
        const summary = JSON.parse(row.summary);
        const conflict = conflictingPaths.has(row.path);
        return { ...summary, path: row.path, contentHash: row.hash, observedRevision: row.revision,
          state: conflict ? "conflict" : row.revision !== revision ? "unobserved" : summary.state,
          reason: summary.reason ?? (conflict ? "DUPLICATE_TASK_ID_HISTORY" : null),
          conflictReason: conflict ? "DUPLICATE_TASK_ID_HISTORY" : null, ...flags };
      });
      db.exec("COMMIT");
      return { revision, sourceRoot: root, items, ...flags };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  readVersion(contentHash) {
    if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("INVALID_CONTENT_HASH");
    return this.db.prepare("SELECT markdown FROM versions WHERE hash=?").get(contentHash)?.markdown ?? null;
  }
  close() { this.db?.close(); this.db = null; }
}
