import assert from "node:assert/strict";
import { mkdtemp, readFile, chmod, symlink, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { personalServiceCredentials } from "../shared/personal-service.mjs";

test("only the service creates credentials, restart reuses them and unsafe files fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "personal-creds-"));
  try {
    await assert.rejects(personalServiceCredentials(root), { code: "ENOENT" });
    const first = await personalServiceCredentials(root, { create: true });
    assert.deepEqual(await personalServiceCredentials(root, { create: true }), first);
    assert.deepEqual(await personalServiceCredentials(root), first);
    if (process.platform !== "win32") {
      const file = path.join(root, "personal-service.json");
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      await chmod(file, 0o644);
      await assert.rejects(personalServiceCredentials(root), /private file/);
      await chmod(file, 0o600);
      const linked = path.join(root, "linked");
      await symlink(root, linked);
      // A symlink for the credentials file itself is refused.
      const other = await mkdtemp(path.join(os.tmpdir(), "personal-link-"));
      try {
        await symlink(file, path.join(other, "personal-service.json"));
        await assert.rejects(personalServiceCredentials(other));
      } finally { await rm(other, { recursive: true, force: true }); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("external injector refuses all launcher lifecycle combinations", async () => {
  const source = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function parseArgs(");
  const end = source.indexOf("async function fetchJson", start);
  const parse = vm.runInNewContext(`(${source.slice(start, end).trim()})`, { process, path, defaultCodexDebuggingPort: 9229 });
  const base = ["--external-service", "--watch", "--attach-existing"];
  assert.equal(parse(base).externalService, true);
  for (const flag of ["--launch", "--daemon", "--cdp-pipe", "--refresh", "--refresh-if-running"]) {
    assert.throws(() => parse([...base, flag]), /forbids lifecycle/);
  }
  assert.throws(() => parse(["--external-service"]), /requires/);
});

test("failed resident injection revokes its registration, DOM, and CSP before closing", async () => {
  const { EventEmitter } = await import("node:events");
  const { guardCodexSource } = await import("../scripts/codex-target-trust.mjs");
  const source = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
  const cdp = new EventEmitter();
  const calls = [];
  const window = { location: new URL("app://-/"), __CODEX_TASKBOARD_HOST_CAPABILITY__: "fixture", __CODEX_TASKBOARD_URL__: "private", __codexTaskboardInjection__: { destroy() { calls.push("destroy"); } } };
  window.top = window;
  cdp.send = async (method, params) => {
    calls.push(method === "Page.setBypassCSP" ? `${method}:${params.enabled}` : method);
    if (method === "Runtime.evaluate") vm.runInNewContext(params.expression, { window });
    return {};
  };
  cdp.close = () => calls.push("close");
  const context = vm.createContext({
    guardCodexSource, hostCapability: "fixture", console,
    requireTrustedCodexFrame: async () => {}, isCodexTarget: () => true,
    installTaskboardHostBinding: () => ({ install: async () => {}, publishHeartbeat: async () => {}, dispose: () => calls.push("dispose") }),
    registerInjectionSource: async () => "fixture-registration", evaluateInjectionSource: async () => {}, publishInjectionScriptIdentifier: async () => {},
    waitForInjectionStatus: async () => { throw new Error("fixture UI failure"); }, unregisterQuotaPolicyCdp: () => {},
  });
  vm.runInContext(source.slice(source.indexOf("async function detachTaskboardInjection("), source.indexOf("async function injectAll(")), context);
  await assert.rejects(context.injectTarget({ connect: async () => cdp }, {}, "", "", false, null, true, {}, false, "", () => {}, () => {}, () => {}), /fixture UI failure/);
  assert.ok(calls.includes("Page.removeScriptToEvaluateOnNewDocument"));
  assert.ok(calls.includes("destroy"));
  assert.ok(calls.includes("dispose"));
  assert.ok(calls.includes("Page.setBypassCSP:false"));
  assert.equal(window.__CODEX_TASKBOARD_URL__, undefined);
  assert.equal(calls.at(-1), "close");
});
