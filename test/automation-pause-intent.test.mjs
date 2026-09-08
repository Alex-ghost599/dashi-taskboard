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
  return { id: request.automationId, name: buildTaskboardAutomationName(request), model: request.model, reasoningEffort: request.reasoningEffort, rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5", status: "ACTIVE" };
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

test("pause retry timer only sends PAUSED and stops after confirmation", async (t) => {
  const writes = [];
  const h = await harness(t, { rpc: async (method, body) => {
    if (method === "list-automations") return { items: [automation()] };
    writes.push(body.status);
    return { item: { ...automation(), ...body } };
  } });
  h.context.quotaPolicyCdps.add({ closed: false });
  h.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  await assert.rejects(h.context.updateAndApplyQuotaPolicy({ ...request, enabledByUser: false }, async () => { throw new Error("offline"); }));
  assert.equal(h.timers.size, 1);
  await [...h.timers][0].callback();
  assert.deepEqual(writes, ["PAUSED"]);
  assert.equal(h.timers.size, 0);
  assert.equal((await h.read())[request.taskboardProjectId].pausePending, false);
});

test("a non-confirming pause response remains pending for retry", async (t) => {
  const h = await harness(t);
  h.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  await assert.rejects(h.context.updateAndApplyQuotaPolicy({ ...request, enabledByUser: false }, async (method) => (
    method === "list-automations" ? { items: [automation()] } : { item: automation() }
  )), /confirm/i);
  assert.equal((await h.read())[request.taskboardProjectId].pausePending, true);
});

for (const pending of [false, true]) {
  test(`UI refresh ${pending ? "retries an unconfirmed pause" : "only reads an ordinary policy"}`, async () => {
    const { transform } = await import("esbuild");
    const app = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
    const callback = app.slice(app.indexOf("const reconcileProjectAutomation ="), app.indexOf("const saveProjectAutomation ="));
    const stored = { ...request, enabledByUser: !pending, pausePending: pending, status: "ACTIVE" };
    const sent = [];
    let saved;
    const context = vm.createContext({
      useCallback: (fn) => fn,
      automationRequestContext: { taskboardProjectId: request.taskboardProjectId },
      automationCatalog: { projectId: request.taskboardProjectId, models: [{ slug: request.model }] },
      automationRequestInFlightRef: { current: null }, loadedAutomationProjectIdsRef: { current: new Set() },
      projectAutomationsRef: { current: { [request.taskboardProjectId]: stored } },
      setAutomationPending() {}, setAutomationError(error) { if (error) throw new Error(error); },
      drainQueuedAutomationSaves() {}, text: (_zh, en) => en,
      sendAutomationRequest: async (operation, options) => {
        sent.push([operation, options.enabledByUser]);
        return { policy: { ...request, enabledByUser: !pending }, item: { ...automation(), status: pending ? "PAUSED" : "ACTIVE", rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5" } };
      },
      isAutomationHostItem: (item) => !!item, isAutomationHostPolicy: (policy) => !!policy,
      intervalMinutesFromRrule: () => 5,
      writeProjectAutomation: (_id, value) => { saved = value; }, Error,
    });
    vm.runInContext((await transform(callback + '\nglobalThis.reconcile = reconcileProjectAutomation;', { loader: "ts", target: "es2022" })).code, context);
    await context.reconcile();
    assert.deepEqual(sent, [[pending ? "apply-policy" : "list", !pending]]);
    assert.equal(saved.enabledByUser, !pending);
    assert.equal(saved.pausePending === true, false);
  });
}

test("UI persists a pause before an unfinished host request can lose the page", async () => {
  const { transform } = await import("esbuild");
  const app = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const callback = app.slice(app.indexOf("const saveProjectAutomation ="), app.indexOf("function openTaskDetail"));
  let saved;
  const context = vm.createContext({
    useCallback: (fn) => fn, automationRequestContext: request,
    queuedAutomationSavesRef: { current: new Map() },
    automationRequestInFlightRef: { current: "list" },
    projectAutomationsRef: { current: { [request.taskboardProjectId]: { ...request, status: "ACTIVE" } } },
    writeProjectAutomation: (_id, record) => { saved = record; },
    drainQueuedAutomationSaves: () => { throw new Error("must wait for in-flight request"); },
  });
  vm.runInContext((await transform(callback + '\nglobalThis.save = saveProjectAutomation;', { loader: "ts", target: "es2022" })).code, context);
  context.save({ ...request, enabledByUser: false });
  assert.equal(saved?.enabledByUser, false);
  assert.equal(saved?.pausePending, true);
});


test("passive project identity refresh respects an externally paused schedule", async (t) => {
  const h = await harness(t);
  h.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  const writes = [];
  await h.context.reconcileStoredAutomationPolicy({ ...request, codexProjectId: "new-project-id" }, async (method, body) => {
    if (method === "list-automations") return { items: [{ ...automation(), status: "PAUSED" }] };
    writes.push(body.status);
    return { item: { ...automation(), ...body } };
  });
  assert.deepEqual(writes, []);
  assert.equal((await h.read())[request.taskboardProjectId].enabledByUser, false);
});

test("offline restart keeps a pending pause retry without breaking bridge restoration", async (t) => {
  const first = await harness(t);
  first.context.quotaPolicyRecords.set(request.taskboardProjectId, { version: 1, request });
  await assert.rejects(first.context.updateAndApplyQuotaPolicy({ ...request, enabledByUser: false }, async () => { throw new Error("offline"); }));
  const restarted = await harness(t, { directory: first.directory, rpc: async () => { throw new Error("still offline"); } });
  await restarted.context.restoreQuotaPolicies({ closed: false });
  assert.equal(restarted.timers.size, 1);
  assert.equal((await restarted.read())[request.taskboardProjectId].pausePending, true);
});

test("storage is updated before React rendering and stale replies preserve a queued pause", async () => {
  const { transform } = await import("esbuild");
  const app = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const callback = app.slice(app.indexOf("const writeProjectAutomation ="), app.indexOf("const sendAutomationRequest ="));
  let disk;
  const context = vm.createContext({
    useCallback: (fn) => fn,
    projectAutomationsRef: { current: { [request.taskboardProjectId]: { ...request, status: "ACTIVE" } } },
    queuedAutomationSavesRef: { current: new Map([[request.taskboardProjectId, { options: { enabledByUser: false } }]]) },
    PROJECT_AUTOMATIONS_KEY: "fixture", taskboardStorage: { setItem: (_key, value) => { disk = JSON.parse(value); } },
    setProjectAutomations: () => {},
  });
  vm.runInContext((await transform(callback + '\nglobalThis.write = writeProjectAutomation;', { loader: "ts", target: "es2022" })).code, context);
  context.write(request.taskboardProjectId, { ...request, status: "ACTIVE" });
  assert.equal(disk[request.taskboardProjectId].enabledByUser, false);
  assert.equal(disk[request.taskboardProjectId].pausePending, true);
});

test("unavailable browser storage cannot prevent a pause request or swallow a later retry", async () => {
  const { transform } = await import("esbuild");
  const app = await readFile(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const writer = app.slice(app.indexOf("const writeProjectAutomation ="), app.indexOf("const sendAutomationRequest ="));
  const saver = app.slice(app.indexOf("const saveProjectAutomation ="), app.indexOf("function openTaskDetail"));
  let writes = 0;
  let attempts = 0;
  const errors = [];
  const context = vm.createContext({
    useCallback: (fn) => fn, automationRequestContext: request,
    projectAutomationsRef: { current: { [request.taskboardProjectId]: { ...request, status: "ACTIVE" } } },
    queuedAutomationSavesRef: { current: new Map() }, automationRequestInFlightRef: { current: null },
    PROJECT_AUTOMATIONS_KEY: "fixture", taskboardStorage: { setItem: () => { writes++; throw new Error("storage full"); } },
    setProjectAutomations() {}, setAutomationError: (error) => errors.push(error),
    textRef: { current: (_zh, en) => en },
    drainQueuedAutomationSaves: () => { attempts++; },
  });
  vm.runInContext((await transform(writer + saver + '\nglobalThis.save = saveProjectAutomation;', { loader: "ts", target: "es2022" })).code, context);
  context.save({ ...request, enabledByUser: false });
  context.save({ ...request, enabledByUser: false });
  assert.equal(attempts, 2);
  assert.equal(writes, 2);
  assert.ok(errors.length > 0);
});
