import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import vm from "node:vm";
import { isCodexTarget } from "../scripts/codex-target-trust.mjs";

const source = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
const runtimeSource = await readFile(
  new URL("../scripts/codex-injector-runtime.mjs", import.meta.url),
  "utf8",
);
const supervisorSource = await readFile(
  new URL("../scripts/taskboard-supervisor.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const execFileAsync = promisify(execFile);

// Run the actual npm script chains in a disposable package; every tool is a recording stub.
// The real injector is never copied or executed, including when the old build calls it.
async function recordedPackageScript(t, script) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "injector-build scripts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "node_modules", ".bin"), scripts = path.join(directory, "scripts");
  await mkdir(bin, { recursive: true }); await mkdir(scripts);
  await writeFile(path.join(directory, "package.json"), JSON.stringify({
    name: "isolated-script-recording", version: "1.0.0", type: "module", scripts: packageJson.scripts,
  }));
  const log = path.join(directory, "calls.jsonl"), stub = path.join(scripts, "record-tool.mjs");
  const record = 'import {appendFileSync} from "node:fs";\n'
    + 'appendFileSync(process.env.TASKBOARD_SCRIPT_TEST_LOG, JSON.stringify({tool:process.argv[2],args:process.argv.slice(3)})+"\\n");\n';
  await writeFile(stub, record);
  for (const tool of ["vite", "tsc", "vitest"]) {
    if (process.platform === "win32") {
      await writeFile(path.join(bin, `${tool}.cmd`), `@echo off\r\n"%TASKBOARD_SCRIPT_TEST_NODE%" "%TASKBOARD_SCRIPT_TEST_STUB%" ${tool} %*\r\n`);
    } else {
      await writeFile(path.join(bin, tool), `#!/bin/sh\nexec "$TASKBOARD_SCRIPT_TEST_NODE" "$TASKBOARD_SCRIPT_TEST_STUB" ${tool} "$@"\n`, { mode: 0o755 });
    }
  }
  await writeFile(path.join(scripts, "codex-injector.mjs"), record.replace('process.argv[2]', '"injector"').replace('process.argv.slice(3)', 'process.argv.slice(2)'));
  await writeFile(path.join(scripts, "run-node-tests.mjs"), record.replace('process.argv[2]', '"test:node"').replace('process.argv.slice(3)', 'process.argv.slice(2)'));
  await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script, "--silent"], {
    cwd: directory, timeout: 20000, shell: process.platform === "win32",
    env: { ...process.env, TASKBOARD_SCRIPT_TEST_NODE: process.execPath, TASKBOARD_SCRIPT_TEST_STUB: stub, TASKBOARD_SCRIPT_TEST_LOG: log },
  });
  return (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
}

test("the resident injector authenticates its launcher-managed Taskboard service", () => {
  assert.match(supervisorSource, /function createTaskboardSupervisor/);
  assert.match(source, /CODEX_TASKBOARD_INSTANCE_TOKEN/);
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /x-codex-taskboard-challenge/);
  assert.match(source, /proof/);
  assert.match(source, /taskboardInstanceSecret/);
  assert.match(source, /Page\.setDocumentContent/);
  assert.match(runtimeSource, /request\.action === "load-frame"/);
  assert.match(supervisorSource, /ensureInFlight/);
  assert.match(supervisorSource, /await terminateManagedChild\(managedChild\)/);
  assert.match(source, /await supervisor\.ensure\(\)/);
  assert.match(source, /it will be restarted automatically/);
  assert.match(source, /AbortSignal\.timeout\(1_500\)/);
  assert.match(source, /__CODEX_TASKBOARD_FRAME_CAPABILITY__/);
  assert.match(runtimeSource, /request\.frameCapability/);
});

test("the CDP bridge accepts service ensure and native task conversation start actions", () => {
  assert.match(source, /const hostBindingName = "__codexTaskboardHostV1"/);
  assert.match(runtimeSource, /request\.action === "ensure"/);
  assert.match(runtimeSource, /request\.action === "start-task-conversation"/);
  assert.match(runtimeSource, /request\.action === "open-external"/);
  assert.match(runtimeSource, /request\.taskId/);
  assert.match(runtimeSource, /request\.previousThreadId\.length <= 240/);
  assert.match(runtimeSource, /request\.codexHostId\.length <= 240/);
  assert.match(runtimeSource, /request\.targetRoot\.length <= 4_096/);
  assert.match(runtimeSource, /payload\.length > 4_194_304/);
  assert.match(runtimeSource, /request\.instruction\.length <= 4_000_000/);
  assert.match(runtimeSource, /request\.title\.length <= 240/);
  assert.match(source, /async function startTaskConversationViaCdp/);
  assert.match(source, /data-composer-placement="home"/);
  assert.match(source, /\(editor\.innerText \|\| ""\) !== \$\{JSON\.stringify\(instruction\)\}/);
  assert.doesNotMatch(source, /cdp\.send\("Input\.insertText", \{ text: instruction \}\)/);
  assert.match(
    source,
    /cdp\.send\("Input\.dispatchKeyEvent", \{\s*type: "keyDown",\s*key: "Enter"/,
  );
  assert.match(
    source,
    /cdp\.send\("Input\.dispatchKeyEvent", \{\s*type: "keyUp",\s*key: "Enter"/,
  );
  assert.match(source, /submitted = true/);
  assert.match(source, /if \(!submitted\) throw new Error/);
  assert.match(source, /const threadId = typeof started\.result\.value === "string"/);
  assert.match(source, /threadId && threadId !== previousThreadId/);
  assert.match(source, /discoveredThreadId = threadId/);
  assert.match(source, /error\.threadId = discoveredThreadId/);
  assert.match(source, /function requestCodexAppServerViaCdp/);
  assert.match(source, /type: "mcp-request"/);
  assert.match(source, /hostId: \$\{JSON\.stringify\(hostId\)\}/);
  assert.match(source, /"thread\/read"/);
  assert.match(source, /normalizeWorkspaceRoot\(result\.thread\.cwd\) === normalizedTargetRoot/);
  assert.match(source, /"thread\/name\/set"/);
  assert.match(source, /result\.thread\.name === title/);
  assert.match(source, /const taskConversationOperations = new Map\(\)/);
  assert.match(source, /taskConversationOperations\.get\(request\.taskId\)/);
  assert.match(source, /const taskConversationAppServerTimeoutMs = 30_000/);
  assert.doesNotMatch(source, /window\.postMessage\(\{ type: "rename-thread" \}/);
  assert.match(source, /return \{ threadId, title \}/);
  assert.match(source, /Runtime\.bindingCalled/);
  assert.match(source, /Page\.createIsolatedWorld/);
  assert.match(source, /Runtime\.addBinding", \{\s*name: hostBindingName,\s*executionContextId:/);
  assert.match(source, /params\.executionContextId !== activeContextId/);
  assert.match(runtimeSource, /params\.executionContextId/);
  assert.match(runtimeSource, /threadId: error\.threadId/);
  assert.match(source, /hostResponseMessage/);
  assert.match(source, /if \(keepAlive\) await hostBridge\.install\(\)/);
  assert.match(source, /hostBridge\.publishHeartbeat/);
  assert.match(source, /withoutTaskboardLauncherEnvironment\(process\.env\)/);
});

test("the CDP bridge exposes only the fixed Taskboard automation operations", () => {
  assert.match(source, /parseTaskboardAutomationHostRequest/);
  assert.match(source, /reconcileTaskboardAutomation/);
  assert.match(runtimeSource, /request\.action === "automation"/);
  assert.match(source, /function requestCodexAutomationViaCdp/);
  assert.match(source, /new Set\(\[\s*"list-automations",\s*"automation-create",\s*"automation-update",\s*\]\)/);
  assert.match(source, /bridge\.sendMessageFromView\(\{\s*type: "fetch",\s*requestId,/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /vscode:\/\/codex\/\$\{method\}/);
  assert.match(source, /body: JSON\.stringify\(params\)/);
  assert.match(source, /message\.type !== "fetch-response"/);
  assert.match(source, /message\.responseType/);
  assert.match(source, /message\.status/);
  assert.match(source, /message\.bodyJsonString/);
  assert.doesNotMatch(source, /automation-delete/);
  assert.doesNotMatch(source, /automations\.toml/);
});

test("passive automation policy keeps idle pauses and only resumes quota pauses", () => {
  assert.match(source, /taskboardAutomationPolicyOperation/);
  assert.match(source, /previousQuotaState: current\.quota\?\.state/);
  assert.match(source, /enqueueQuotaPolicyMutation\(record, rpc, \{ explicit: source === "user" \}\)/);
  assert.match(
    source,
    /!explicit && result\.operation === "list" && result\.item\?\.status === "PAUSED"/,
  );
  assert.match(source, /enabledByUser: false/);
  assert.match(source, /record\.quota \? \{ quota: record\.quota \} : \{\}/);
});

test("persisted automation policies retain remote project identity", () => {
  const storedPolicySource = source.slice(
    source.indexOf("function storedAutomationPolicy"),
    source.indexOf("function restoredAutomationPolicy"),
  );
  assert.match(storedPolicySource, /codexProjectKind: request\.codexProjectKind/);
  assert.match(storedPolicySource, /codexHostId: request\.codexHostId/);
  assert.match(storedPolicySource, /remoteProjects: request\.remoteProjects/);
});

test("automation list rebuilds a stored policy on the incoming project identity", async () => {
  const reconcileSource = source.slice(
    source.indexOf("async function reconcileStoredAutomationPolicy"),
    source.indexOf("async function enqueueCurrentQuotaPolicy"),
  );
  const storedRequest = {
    taskboardProjectId: "taskboard-project",
    codexProjectId: "old-project",
    codexProjectKind: "local",
    codexHostId: "local",
    projectName: "Old project",
    workspacePath: "/old/project",
    skillPath: "/old/skill/SKILL.md",
    automationId: "automation-1",
    enabledByUser: true,
    quotaAware: true,
    intervalMinutes: 15,
    model: "gpt-5.5",
    reasoningEffort: "high",
  };
  const incomingRequest = {
    ...storedRequest,
    codexProjectId: "remote-project",
    codexProjectKind: "remote",
    codexHostId: "remote-host",
    projectName: "Remote project",
    workspacePath: "/remote/project",
    remoteProjects: [{
      codexProjectId: "remote-worktree",
      codexProjectKind: "remote",
      codexHostId: "remote-host",
      workspacePath: "/remote/project-worktree",
    }],
    skillPath: "/new/skill/SKILL.md",
    enabledByUser: false,
    quotaAware: false,
    intervalMinutes: 5,
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
  };
  let appliedRequest;
  const reconcileStoredAutomationPolicy = vm.runInNewContext(`(${reconcileSource})`, {
    ensureQuotaPoliciesLoaded: async () => {},
    quotaPolicyRecords: new Map([[
      storedRequest.taskboardProjectId,
      { request: storedRequest },
    ]]),
    updateAndApplyQuotaPolicy: async (request) => {
      appliedRequest = request;
      return { policy: request };
    },
    enqueueQuotaPolicyMutation: () => {
      throw new Error("stored target must not continue");
    },
    storedAutomationPolicy: (request) => request,
  });

  const result = await reconcileStoredAutomationPolicy(incomingRequest, () => {});
  assert.deepEqual(
    JSON.parse(JSON.stringify(appliedRequest)),
    {
      ...incomingRequest,
      automationId: "automation-1",
      enabledByUser: true,
      quotaAware: true,
      intervalMinutes: 15,
      model: "gpt-5.5",
      reasoningEffort: "high",
    },
  );
  assert.equal(result.policy, appliedRequest);
  assert.match(source, /reconcileStoredAutomationPolicy\(\s*request,\s*rpc/);
  assert.match(source, /policy: storedAutomationPolicy\(current\.request\)/);
});

test("managed private-CDP spawn failures are bounded without changing the launch path", async () => {
  const launchStart = source.indexOf("function managedCodexSpawnFailure");
  const launchEnd = source.indexOf("class CdpConnection", launchStart);
  assert.notEqual(launchStart, -1);
  assert.notEqual(launchEnd, -1);

  const executable = String.raw`C:\Users\alice\AppData\Roaming\Codex Taskboard\codex-runtime\codex.exe`;
  const profile = String.raw`C:\Users\alice\AppData\Roaming\Codex Taskboard\codex-profile`;
  const launches = [];
  let spawnMode = "failure";
  let browserOpenCount = 0;
  class TestPipeBrowser {
    constructor(child) {
      this.child = child;
    }

    async open() {
      browserOpenCount += 1;
    }
  }
  const { launchCodexWithPipe } = vm.runInNewContext(
    `(() => {
      ${source.slice(launchStart, launchEnd)}
      return { launchCodexWithPipe };
    })()`,
    {
      CdpPipeBrowser: TestPipeBrowser,
      Error,
      once,
      codexExecutablePath: (appPath) => appPath,
      independentCodexProfilePath: profile,
      process: { env: { SAFE_VALUE: "kept", CODEX_TASKBOARD_SECRET: "removed" } },
      spawn: (command, args, options) => {
        launches.push({ command, args, options });
        const child = new EventEmitter();
        child.exitCode = null;
        child.signalCode = null;
        child.kill = () => true;
        if (spawnMode === "success") {
          child.pid = 376;
        } else {
          queueMicrotask(() => child.emit("error", Object.assign(
            new Error(`spawn ${command} EPERM`),
            {
              code: "EPERM",
              errno: -4048,
              syscall: `spawn ${command}`,
            },
          )));
        }
        return child;
      },
      withoutTaskboardLauncherEnvironment: (environment) => ({
        SAFE_VALUE: environment.SAFE_VALUE,
      }),
    },
  );

  await assert.rejects(launchCodexWithPipe(executable), (failure) => {
    assert.equal(failure.managedCodexSpawnFailure, true);
    assert.match(failure.message, /Managed Codex spawn failed/);
    assert.match(
      failure.message,
      /arguments=\["--user-data-dir=<taskboard-profile>","--remote-debugging-pipe"\]/,
    );
    assert.match(failure.message, /code=EPERM/);
    assert.match(failure.message, /errno=-4048/);
    assert.ok(failure.message.includes(`syscall=${JSON.stringify(`spawn ${executable}`)}`));
    assert.doesNotMatch(failure.message, /codex-profile/);
    return true;
  });
  assert.equal(browserOpenCount, 0);

  spawnMode = "success";
  const launched = await launchCodexWithPipe(executable);
  assert.equal(launched.child.pid, 376);
  assert.equal(browserOpenCount, 1);
  assert.equal(launches.at(-1).command, executable);
  assert.deepEqual(Array.from(launches.at(-1).args), [
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
  ]);
  assert.deepEqual(
    Array.from(launches.at(-1).options.stdio),
    ["ignore", "ignore", "ignore", "pipe", "pipe"],
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(launches.at(-1).options.env)),
    { SAFE_VALUE: "kept" },
  );

  assert.match(source, /if \(!options\.watch \|\| error\?\.managedCodexSpawnFailure !== true\) throw error/);
  assert.equal(
    source.match(/const launchRequestGeneration = openRequestGeneration;/g)?.length,
    3,
  );
  assert.equal(
    source.match(
      /openedRequestGeneration = Math\.max\(\s*openedRequestGeneration,\s*launchRequestGeneration,\s*\);/g,
    )?.length,
    3,
  );
  assert.match(source, /if \(!hasOpenPending\(\)\) continue;/);
  assert.match(source, /idleAfterNormalExit = true;\s*console\.error\(`Waiting for Codex launch:/);
});

test("the package injection command remains resident for tab-triggered recovery", () => {
  assert.match(packageJson.scripts["codex:inject"], /--watch/);
  assert.match(packageJson.scripts["codex:daemon"], /--daemon --open/);
  assert.match(source, /function startResidentInjector/);
  assert.match(source, /const defaultCodexDebuggingPort = 9229/);
  assert.match(source, /port: defaultCodexDebuggingPort/);
  assert.match(source, /--startup-token/);
  assert.match(source, /__codexTaskboardHostStartupTokenV1/);
});

test("attach reconciles the renderer against a hashed current injection source", () => {
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /__CODEX_TASKBOARD_SOURCE_HASH__/);
  assert.match(source, /sourceHash: window\.__codexTaskboardInjection__\?\.sourceHash \|\| null/);
  assert.match(source, /const injectionScriptIdentifierName = "__CODEX_TASKBOARD_SCRIPT_IDENTIFIER__"/);
  assert.match(source, /scriptIdentifier: window\[\$\{JSON\.stringify\(injectionScriptIdentifierName\)\}\] \|\| null/);
  assert.match(source, /Page\.removeScriptToEvaluateOnNewDocument/);
  assert.match(source, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(source, /reconcileInjectionRuntime/);
  assert.match(source, /expectedSourceHash/);
});

test("the injector ignores auxiliary Codex windows", () => {
  for (const route of ["/global-dictation", "/avatar-overlay"]) {
    assert.equal(isCodexTarget({ type: "page", url: `app://-/index.html?initialRoute=${encodeURIComponent(route)}`, title: "Codex" }), false);
  }
});

test("a completed build runs only the web compiler without calling the injector", async t => {
  const calls = await recordedPackageScript(t, "build");
  assert.deepEqual(calls, [{ tool: "vite", args: ["build", "--config", "web/vite.config.ts"] }]);
});

test("the check chain runs typecheck, pure build and tests without calling the injector", async t => {
  const calls = await recordedPackageScript(t, "check");
  assert.deepEqual(calls.map(call => call.tool), ["tsc", "vite", "test:node", "vitest"]);
  assert.deepEqual(calls[0].args, ["-p", "web/tsconfig.json", "--noEmit"]);
  assert.deepEqual(calls[1].args, ["build", "--config", "web/vite.config.ts"]);
  assert.equal(calls[3].args[0], "run");
});

test("explicit codex refresh retains its existing injector command and frame refresh support", async t => {
  assert.deepEqual(await recordedPackageScript(t, "codex:refresh"), [{ tool: "injector", args: ["--refresh"] }]);
  assert.match(source, /async function refreshTaskboardFrames/);
  assert.match(source, /function codexDebuggingPorts/);
  assert.match(source, /--remote-debugging-port=/);
  assert.match(source, /taskboard\.reloadFrame\(\)/);
  assert.match(source, /__codex_taskboard_refresh/);
  assert.match(source, /await restartResidentInjectorForRefresh\(port\)/);
});

test("the injected iframe follows the configured local service port", () => {
  assert.match(source, /const taskboardBaseUrl = `\$\{taskboardOrigin\}\/\$\{encodeURIComponent\(taskboardInstanceToken\)\}`/);
  assert.match(source, /const taskboardPageUrl = `\$\{taskboardBaseUrl\}\/\?host=codex`/);
  assert.match(source, /window\.__CODEX_TASKBOARD_URL__ = \$\{JSON\.stringify\(taskboardPageUrl\)\}/);
});
