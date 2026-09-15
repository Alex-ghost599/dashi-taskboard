import { randomUUID } from "node:crypto";
import { assessCandidate } from "../shared/automation-candidates.mjs";

// Scan-only: no model client, task mutations or dispatch callback exists here.
export class LocalCandidateScanner {
  constructor({ reader, state, clock = Date.now, owner = randomUUID(), onError = () => {} }) {
    this.reader = reader;
    this.state = state;
    this.clock = clock;
    this.owner = owner;
    this.onError = onError;
    this.due = new Map();
    this.pending = null;
    this.timer = null;
    this.running = false;
    this.stopping = null;
    this.generation = 0;
  }

  tick() {
    if (this.pending) return this.pending;
    this.pending = this.scan().finally(() => { this.pending = null; });
    return this.pending;
  }

  async scan() {
    if (!this.state.acquire(this.owner, this.clock(), 60000)) return;
    const configs = this.state.listProjects();
    for (const config of configs) {
      if (!config.armed) { this.due.delete(config.projectId); continue; }
      const due = this.due.get(config.projectId);
      if (due?.revision === config.revision && due.at > this.clock()) continue;
      let report;
      try {
        const snapshot = await this.reader.read(config.projectId, config.judgePolicyRev);
        snapshot.unresolvedTaskIds = this.state.unresolvedTaskIds(this.clock());
        report = { status: "armed", candidates: [], blocked: [], authorizesDispatch: false };
        for (const task of snapshot.tasks) {
          if (task.projectId !== config.projectId || task.status !== "todo" || task.archived) continue;
          const result = assessCandidate(task.id, snapshot);
          if (result.decision === "candidate") report.candidates.push({ taskId: task.id, judgmentKey: result.judgmentKey });
          else report.blocked.push({ taskId: task.id, reason: result.reason });
        }
      } catch {
        // Error text can contain task contents, SQL or personal paths; never persist it.
        report = { status: "error", error: "SNAPSHOT_UNAVAILABLE", candidates: [], blocked: [], authorizesDispatch: false };
      }
      this.state.record(config.projectId, config.revision, this.owner, this.clock(), report);
      // Schedule from completion, so sleep/resume never replays missed intervals.
      this.due.set(config.projectId, { revision: config.revision, at: this.clock() + config.intervalMs });
    }
  }

  start() {
    if (this.stopping) throw new Error("SCAN_STOPPING");
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    const loop = async () => {
      try { await this.tick(); } catch { this.onError("SCAN_UNAVAILABLE"); }
      if (this.running && generation === this.generation) this.timer = setTimeout(loop, 1000);
    };
    void loop();
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.running = false;
    this.generation++;
    clearTimeout(this.timer);
    this.stopping = (async () => {
      try { await this.pending; } finally { this.state.release(this.owner, this.clock()); }
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
}
