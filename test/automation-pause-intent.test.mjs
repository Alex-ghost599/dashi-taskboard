import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import {
  buildTaskboardAutomationName,
  parseTaskboardAutomationHostRequest,
  reconcileTaskboardAutomation,
  taskboardAutomationPolicyOperation,
} from "../shared/taskboard-automation.mjs";

const source = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
const policySource = source.slice(source.indexOf("function remoteAutomationItem"), source.indexOf("async function startTaskConversationViaCdp"));
const request = {
  id: "fixture", requestId: "fixture", action: "automation", operation: "apply-policy",
  taskboardProjectId: "fixture-project", codexProjectId: "fixture-project",
  codexProjectKind: "local", codexHostId: "local", projectName: "Pause fixture",
  workspacePath: "/fixture", skillPath: "/fixture/SKILL.md", automationId: "fixture-automation",
  enabledByUser: true, quotaAware: false, intervalMinutes: 5,
  model: "gpt-6-astra", reasoningEffort: "low",
};

async function harness(t, { directory, rpc } = {}) {
  directory ??= await mkdtemp(path.join(os.tmpdir(), "taskboard-pause-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const timers = new Set();
  const context = vm.createContext({
    console, Date, Number, JSON, Map, Set, Promise, Error, path, mkdir, readFile, writeFile,
    automationPoliciesPath: path.join(directory, "policies.json"),
    quotaPoliciesLoadPromise: null, quotaPoliciesWritePromise: Promise.resolve(),
    quotaPolicyRecords: new Map(), quotaPolicyTimers: new Map(), quotaPolicyQueues: new Map(),
    quotaPolicyCdps: new Set(), restoredQuotaPolicyCdps: new WeakSet(), quotaPolicyRestorePromises: new WeakMap(),
    taskboardBaseUrl: "http://127.0.0.1/fixture",
    fetch: async () => ({ ok: true, json: async () => ({ tasks: [{ id: "fixture-todo" }] }) }),
    readCodexQuotaStatus: async () => ({ state: "available" }),
    parseTaskboardAutomationHostRequest, reconcileTaskboardAutomation, taskboardAutomationPolicyOperation,
    requestCodexAutomationViaCdp: (_cdp, _context, method, body) => rpc(method, body),
    setTimeout: (callback) => { const timer = { callback, unref() {} }; timers.add(timer); return timer; },
    clearTimeout: (timer) => timers.delete(timer),
  });
  vm.runInContext(policySource, context);
  return { context, directory, timers, read: async () => JSON.parse(await readFile(path.join(directory, "policies.json"), "utf8")) };
}

function automation() {
  return { id: request.automationId, name: buildTaskboardAutomationName(request), status: "ACTIVE" };
}

test("a failed scheduled pause retains the user's disabled intent on disk", async (t) => {
  const h = await harness(t);
  h.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  const rpc = async (method) => {
    if (method === "list-automations") return { items: [automation()] };
    throw new Error("fixture transport failure");
  };
  await assert.rejects(h.context.updateAndApplyQuotaPolicy({ ...request, enabledByUser: false }, rpc), /fixture transport failure/);
  assert.equal((await h.read())[request.taskboardProjectId].enabledByUser, false);
  assert.equal(h.context.quotaPolicyRecords.get(request.taskboardProjectId).request.enabledByUser, false);
});

test("restart retries an unconfirmed pause without any ACTIVE write", async (t) => {
  const first = await harness(t);
  first.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  await assert.rejects(first.context.updateAndApplyQuotaPolicy({ ...request, enabledByUser: false }, async () => { throw new Error("offline"); }));
  const writes = [];
  const restarted = await harness(t, { directory: first.directory, rpc: async (method, body) => {
    if (method === "list-automations") return { items: [automation()] };
    writes.push(body.status);
    return { item: { ...automation(), ...body } };
  } });
  await restarted.context.restoreQuotaPolicies({ closed: false });
  assert.deepEqual(writes, ["PAUSED"]);
  assert.equal((await restarted.read())[request.taskboardProjectId].enabledByUser, false);
});

test("an enable invalidated while listing cannot emit a later ACTIVE mutation", async (t) => {
  const h = await harness(t);
  let current = true;
  const writes = [];
  const result = await h.context.applyTaskboardAutomationPolicy(request, async (method, body) => {
    if (method === "list-automations") { current = false; return { items: [automation()] }; }
    writes.push(body.status);
    return { item: { ...automation(), ...body } };
  }, () => current, { explicit: true });
  assert.deepEqual(writes, []);
  assert.equal(result.stale, true);
});

test("UI retains an unconfirmed pause instead of restoring the enabled setting", async () => {
  const { transform } = await import("esbuild");
  const app = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const callback = app.slice(app.indexOf("const drainQueuedAutomationSaves ="), app.indexOf("const reconcileProjectAutomation ="));
  let saved;
  const context = vm.createContext({
    useCallback: (fn) => fn,
    automationRequestInFlightRef: { current: null },
    queuedAutomationSavesRef: { current: new Map([["fixture-project", { projectId: "fixture-project", options: { ...request, enabledByUser: false }, context: {} }]]) },
    projectAutomationsRef: { current: { "fixture-project": { ...request, status: "ACTIVE" } } },
    setAutomationPending() {}, setAutomationError() {},
    sendAutomationRequest: async () => { throw new Error("timeout"); },
    writeProjectAutomation: (_id, value) => { saved = value; },
    textRef: { current: (_zh, en) => en }, Error,
  });
  vm.runInContext((await transform(callback + '\nglobalThis.drain = drainQueuedAutomationSaves;', { loader: "ts", target: "es2022" })).code, context);
  await context.drain();
  assert.equal(saved.enabledByUser, false);
  assert.equal(saved.pausePending, true);
  assert.equal(saved.status, "ACTIVE", "last observed status stays distinct from requested pause");
});
