import { CandidateStore } from "./automation-candidate-store.mjs";
const id = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

// Optional schema v2 adds scan-only state to the private judgment database.
export class LocalScanState extends CandidateStore {
  constructor(filename) {
    super(filename);
    try {
      this.db.exec("BEGIN IMMEDIATE");
      if (this.db.prepare("PRAGMA user_version").get().user_version === 1) {
        this.db.exec(`CREATE TABLE scan_projects (
          project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
          armed INTEGER NOT NULL, interval_ms INTEGER NOT NULL, judge_policy_rev TEXT NOT NULL,
          report_json TEXT, scanned_at INTEGER
        );
        CREATE TABLE scan_owner (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, expires_at INTEGER NOT NULL);
        INSERT INTO scan_owner VALUES(1,NULL,0);
        PRAGMA user_version=2;`);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } finally { this.close(); }
      throw error;
    }
  }

  listProjects() {
    return this.db.prepare("SELECT * FROM scan_projects ORDER BY project_id").all().map((row) => ({
      projectId: row.project_id, revision: row.revision, armed: Boolean(row.armed), intervalMs: row.interval_ms,
      judgePolicyRev: row.judge_policy_rev, report: row.report_json ? JSON.parse(row.report_json) : null,
      scannedAt: row.scanned_at, authorizesDispatch: false,
    }));
  }

  configure(projectId, expectedRevision, settings, now) {
    if (!id(projectId) || !integer(expectedRevision) || expectedRevision >= Number.MAX_SAFE_INTEGER
      || !settings || Object.keys(settings).length !== 3 || typeof settings.armed !== "boolean"
      || !integer(settings.intervalMs) || settings.intervalMs < 1000 || settings.intervalMs > 60000
      || !id(settings.judgePolicyRev)) throw new Error("Invalid scan settings");
    return this.transaction(now, () => {
      const prior = this.db.prepare("SELECT revision FROM scan_projects WHERE project_id=?").get(projectId);
      if ((prior?.revision ?? 0) !== expectedRevision) throw new Error("STALE_SETTINGS");
      this.db.prepare(`INSERT INTO scan_projects(project_id,revision,armed,interval_ms,judge_policy_rev)
        VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,
        armed=excluded.armed,interval_ms=excluded.interval_ms,judge_policy_rev=excluded.judge_policy_rev,
        report_json=NULL,scanned_at=NULL`).run(projectId, expectedRevision+1, Number(settings.armed), settings.intervalMs, settings.judgePolicyRev);
      return { revision: expectedRevision+1, authorizesDispatch: false };
    });
  }

  acquire(owner, now, ttlMs) {
    if (!id(owner) || !integer(ttlMs) || ttlMs < 1000 || ttlMs > 60000 || !Number.isSafeInteger(now+ttlMs)) throw new Error("Invalid scan lease");
    return this.transaction(now, () => {
      const lock = this.db.prepare("SELECT * FROM scan_owner WHERE id=1").get();
      if (lock.token !== owner && lock.expires_at > now) return false;
      this.db.prepare("UPDATE scan_owner SET token=?,expires_at=? WHERE id=1").run(owner, now+ttlMs);
      return true;
    });
  }

  release(owner, now) {
    return this.transaction(now, () => {
      this.db.prepare("UPDATE scan_owner SET token=NULL,expires_at=0 WHERE id=1 AND token=?").run(owner);
    });
  }

  record(projectId, revision, owner, now, report) {
    if (!id(projectId) || !id(owner) || !integer(revision) || !report
      || !["armed", "error"].includes(report.status) || !Array.isArray(report.candidates)
      || !Array.isArray(report.blocked) || report.candidates.length + report.blocked.length > 1000) throw new Error("Invalid scan report");
    const json = JSON.stringify(report);
    if (json.length > 2_000_000) throw new Error("Scan report too large");
    return this.transaction(now, () => {
      const lock = this.db.prepare("SELECT * FROM scan_owner WHERE id=1").get();
      if (lock.token !== owner || lock.expires_at <= now) return false;
      return this.db.prepare("UPDATE scan_projects SET report_json=?,scanned_at=? WHERE project_id=? AND revision=? AND armed=1")
        .run(json,now,projectId,revision).changes === 1;
    });
  }

  unresolvedTaskIds(now) {
    if (!integer(now)) throw new Error("Invalid timestamp");
    return this.db.prepare("SELECT task_id FROM judgment_attempts WHERE state='unknown' OR (state='leased' AND (started=1 OR lease_until>?))")
      .all(now).map((row)=>row.task_id);
  }
}
