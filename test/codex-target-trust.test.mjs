import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import { guardCodexSource, isCodexTarget, requireTrustedCodexFrame } from "../scripts/codex-target-trust.mjs";

const injector = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
function documentContext(url, child = false) {
  const window = { location: new URL(url), addEventListener() {} };
  window.top = child ? {} : window;
  return vm.createContext({ window, URL });
}

test("target identity ignores titles and rejects other origins, credentials and overlays", () => {
  assert.equal(isCodexTarget({ type: "page", url: "app://-/index.html", title: "Anything" }), true);
  for (const url of ["https://evil.invalid", "http://127.0.0.1:47823", "app://evil/index.html", "app://-:80", "app://user@-", "app://-/index.html?initialRoute=%2Favatar-overlay", "app://-/index.html?initialRoute=%2Fglobal-dictation", "about:blank", undefined]) {
    assert.equal(isCodexTarget({ type: "page", url, title: "Codex" }), false, String(url));
  }
  assert.equal(isCodexTarget({ type: "iframe", url: "app://-/" }), false);
});

test("registered source never assigns secrets on a foreign page or child frame", async () => {
  const start = injector.indexOf("async function currentInjectionSource()");
  const end = injector.indexOf("async function resolveRunnableCodexExecutable", start);
  const { createHash } = await import("node:crypto");
  const factory = vm.runInNewContext(`(${injector.slice(start, end).trim()})`, {
    readFile: async () => "window.mounted = true;", injectionPath: "fixture", createHash,
    taskboardOrigin: "http://127.0.0.1:47823", taskboardPageUrl: "http://127.0.0.1:47823/?token=fixture",
    hostCapability: "fixture-secret", injectionSourceHashName: "sourceHash", guardCodexSource,
  });
  const { source } = await factory();
  for (const [url, child] of [["https://evil.invalid", false], ["app://evil/", false], ["app://-/", true]]) {
    const context = documentContext(url, child);
    context.URL = class { constructor() { return { protocol: "app:", hostname: "-", port: "", searchParams: { get() {} } }; } };
    vm.runInContext(source, context);
    assert.equal(context.window.__CODEX_TASKBOARD_HOST_CAPABILITY__, undefined);
    assert.equal(context.window.__CODEX_TASKBOARD_URL__, undefined);
    assert.equal(context.window.mounted, undefined);
  }
  const context = documentContext("app://-/index.html");
  vm.runInContext(source, context);
  assert.equal(context.window.__CODEX_TASKBOARD_HOST_CAPABILITY__, "fixture-secret");
  assert.equal(context.window.mounted, true);
});

function bridgeFixture({ frameUrl = "app://-/", documentUrl = frameUrl, navigateDuringInstall = false } = {}) {
  const cdp = new EventEmitter();
  const calls = [];
  const notifications = [];
  const listeners = [];
  const context = documentContext(documentUrl);
  context.window.addEventListener = (name, callback) => listeners.push(callback);
  context.notify = (payload) => notifications.push(JSON.parse(payload));
  cdp.send = async (method, params) => {
    calls.push(method);
    if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main", url: frameUrl } } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 7 };
    if (method === "Runtime.evaluate") {
      if (navigateDuringInstall) cdp.emit("Page.frameNavigated", { frame: { id: "main", url: "https://evil.invalid" } });
      return { result: { value: vm.runInContext(params.expression, context) } };
    }
    return {};
  };
  const start = injector.indexOf("function installTaskboardHostBinding(");
  const end = injector.indexOf("async function readInjectionStatus", start);
  const factory = vm.runInNewContext(`(${injector.slice(start, end).trim()})`, {
    guardCodexSource, requireTrustedCodexFrame, hostCapability: "fixture-secret",
    hostBindingName: "host", codexNotificationBindingName: "notify", hostRequestMessage: "request",
    restoreQuotaPolicies: async () => {},
  });
  let ready = 0;
  const received = [];
  const bridge = factory(cdp, {}, "startup", (_, n) => received.push(n), () => ready++);
  return { cdp, bridge, calls, context, notifications, listeners, received, ready: () => ready };
}

test("bridge rejects foreign frames before adding bindings", async () => {
  const fixture = bridgeFixture({ frameUrl: "https://evil.invalid" });
  await assert.rejects(fixture.bridge.install(), /untrusted/);
  assert.deepEqual(fixture.calls, ["Page.getFrameTree"]);
});

test("bridge checks the actual destination after discovery and rejects navigation races", async () => {
  for (const options of [{ documentUrl: "https://evil.invalid" }, { navigateDuringInstall: true }]) {
    const fixture = bridgeFixture(options);
    await assert.rejects(fixture.bridge.install(), /document changed/);
    assert.equal(fixture.ready(), 0);
    fixture.cdp.emit("Runtime.bindingCalled", { executionContextId: 7, name: "notify", payload: '{"hostId":"local","method":"fixture"}' });
    assert.equal(fixture.received.length, 0);
  }
});

test("bridge revokes old context on navigation and accepts a fresh trusted installation", async () => {
  const fixture = bridgeFixture();
  await fixture.bridge.install();
  const notification = { executionContextId: 7, name: "notify", payload: '{"hostId":"local","method":"fixture"}' };
  fixture.cdp.emit("Runtime.bindingCalled", notification);
  assert.equal(fixture.received.length, 1);
  fixture.cdp.emit("Page.frameNavigated", { frame: { id: "main", url: "https://evil.invalid" } });
  fixture.cdp.emit("Runtime.bindingCalled", notification);
  assert.equal(fixture.received.length, 1);
  await fixture.bridge.install();
  fixture.cdp.emit("Runtime.bindingCalled", notification);
  assert.equal(fixture.received.length, 2);
  fixture.cdp.emit("Runtime.executionContextsCleared");
  fixture.cdp.emit("Runtime.bindingCalled", notification);
  assert.equal(fixture.received.length, 2);
});

test("notification forwarding rejects foreign message source or origin", async () => {
  const fixture = bridgeFixture();
  await fixture.bridge.install();
  const message = { type: "mcp-notification", hostId: "local", method: "fixture" };
  const listener = fixture.listeners[0];
  listener({ source: {}, origin: fixture.context.window.location.origin, data: message });
  listener({ source: fixture.context.window, origin: "https://evil.invalid", data: message });
  assert.equal(fixture.notifications.length, 0);
  listener({ source: null, origin: "", data: message });
  assert.equal(fixture.notifications.length, 1);
});

test("pending RPCs do not deliver task parameters after navigation, including a spoofed URL global", async () => {
  for (const name of ["requestCodexAutomationViaCdp", "requestCodexAppServerViaCdp"]) {
    const start = injector.indexOf(`async function ${name}(`);
    const end = injector.indexOf("\nasync function ", start + 20);
    const source = injector.slice(start, end);
    const factory = vm.runInNewContext(`(${source.trim()})`, {
      randomUUID: () => "fixture-random-id",
      guardCodexSource, codexAutomationMethods: new Set(["fixture"]),
      codexAutomationRequestSequence: 0, codexAppServerRequestSequence: 0,
      taskConversationAppServerTimeoutMs: 100, process: { pid: 1 },
    });
    for (const url of ["https://evil.invalid/", "app://-/"]) {
      const context = documentContext(url);
      context.URL = class { constructor() { return { protocol: "app:", hostname: "-", port: "" }; } };
      let delivered = 0;
      let listener;
      context.window.setTimeout = () => 1;
      context.window.clearTimeout = () => {};
      context.window.removeEventListener = () => {};
      context.window.addEventListener = (_, fn) => { listener = fn; };
      context.window.electronBridge = { sendMessageFromView(message) {
        delivered++;
        const data = name === "requestCodexAutomationViaCdp"
          ? { type: "fetch-response", requestId: message.requestId, status: 200, bodyJsonString: "{}" }
          : { type: "mcp-response", hostId: "local", message: { id: message.request.id, result: {} } };
        // Foreign-frame and same-window postMessage replies are not preload IPC.
        for (const [source, origin] of [[{}, "https://evil.invalid"], [context.window, context.window.location.origin], [null, "https://evil.invalid"]]) {
          const bad = name === "requestCodexAutomationViaCdp"
            ? { ...data, status: 500 }
            : { ...data, message: { id: message.request.id, error: { message: "forged" } } };
          listener({ source, origin, data: bad, stopImmediatePropagation() {} });
        }
        listener({ source: null, origin: "", data, stopImmediatePropagation() {} });
      } };
      const cdp = { send: async (_, params) => ({ result: { value: await vm.runInContext(params.expression, context) } }) };
      const args = name === "requestCodexAutomationViaCdp"
        ? [cdp, undefined, "fixture", { task: "private fixture" }]
        : [cdp, undefined, "local", "fixture", { task: "private fixture" }];
      if (url.startsWith("https:")) {
        await assert.rejects(factory(...args), /request failed/);
        assert.equal(delivered, 0);
      } else {
        await factory(...args);
        assert.equal(delivered, 1);
      }
    }
  }
});

test("resident connection restores CSP and disconnects on an untrusted top-level navigation", async () => {
  const start = injector.indexOf("async function injectTarget(");
  const end = injector.indexOf("async function injectAll(", start);
  const cdp = new EventEmitter();
  const calls = [];
  cdp.send = async (method, params) => { calls.push([method, params]); return {}; };
  cdp.close = () => { calls.push(["close"]); };
  let unavailable = 0;
  const factory = vm.runInNewContext(`(${injector.slice(start, end).trim()})`, {
    requireTrustedCodexFrame: async () => ({ id: "main", url: "app://-/" }),
    isCodexTarget,
    installTaskboardHostBinding: () => ({ install: async () => {}, publishHeartbeat: async () => {} }),
    registerInjectionSource: async () => "registration",
    evaluateInjectionSource: async () => {}, publishInjectionScriptIdentifier: async () => {},
    waitForInjectionStatus: async () => ({}), unregisterQuotaPolicyCdp: () => {},
  });
  await factory({ connect: async () => cdp }, {}, "source", "hash", false, null, true, {}, false, "startup", () => {}, () => {}, () => unavailable++);
  cdp.emit("Page.frameNavigated", { frame: { id: "child", parentId: "main", url: "https://evil.invalid" } });
  assert.equal(unavailable, 0);
  cdp.emit("Page.frameNavigated", { frame: { id: "main", url: "https://evil.invalid" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(unavailable, 1);
  assert.ok(calls.some(([method, params]) => method === "Page.setBypassCSP" && params.enabled === false));
  assert.equal(calls.at(-1)[0], "close");
});

test("resident cleanup still runs when discovery finds no trusted targets", async () => {
  const start = injector.indexOf("async function injectAll(");
  const end = injector.indexOf("async function currentInjectionSource(", start);
  let closed = 0;
  let unavailable = 0;
  const connection = { close: () => closed++ };
  const targets = new Map([["old", connection]]);
  const factory = vm.runInNewContext(`(${injector.slice(start, end).trim()})`, { unregisterQuotaPolicyCdp: () => {} });
  await factory({ targets: async () => [] }, "", "", false, null, targets, true, {}, false, "", () => {}, () => {}, () => unavailable++);
  assert.equal(closed, 1);
  assert.equal(unavailable, 1);
  assert.equal(targets.size, 0);
});
