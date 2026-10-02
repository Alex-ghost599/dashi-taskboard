import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CdpPipeBrowser } from "../scripts/codex-cdp-pipe.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const instanceToken = "7a6f8d37-78ce-46c9-87a8-08e10db88da2";
const instanceSecret = "2e587946-96d6-47b5-930a-1ba70214fa88";
const sourceRef = process.env.TASKBOARD_INJECTION_SOURCE_REF;
const source = sourceRef
  ? (await execFileAsync(
      "git",
      ["show", `${sourceRef}:inject/codex-taskboard.user.js`],
      { cwd: projectRoot, maxBuffer: 2 * 1024 * 1024 },
    )).stdout
  : await readFile(new URL("../inject/codex-taskboard.user.js", import.meta.url), "utf8");
const embeddedHostSource = await readFile(
  new URL("../web/src/embeddedHost.mjs", import.meta.url),
  "utf8",
);
const embeddedHostClassicSource = embeddedHostSource.replaceAll("export ", "");

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (_) {}
  }
  return null;
}

async function observeFrameLifecycle(scenario, stopHeartbeat) {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const waitUntil = async (predicate) => {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error("Frame lifecycle fixture did not settle");
      await wait(20);
    }
  };
  await waitUntil(() => window.__codexTaskboardInjection__.ready
    && document.getElementById("codex-taskboard-frame")?.hidden === false);
  await wait(400);
  const initialFrame = document.getElementById("codex-taskboard-frame");
  const initialWindow = initialFrame.contentWindow;
  const initialName = initialFrame.name;
  const initialLoads = window.__loadFrameRequests;
  const initialLoadEvents = window.__frameLoadEvents;
  const initialTimeOrigin = performance.timeOrigin;
  const initialUrl = location.href;
  const snapshot = () => {
    const frame = document.getElementById("codex-taskboard-frame");
    return {
      sameFrame: frame === initialFrame,
      sameWindow: frame?.contentWindow === initialWindow,
      sameName: frame?.name === initialName,
      loadRequests: window.__loadFrameRequests - initialLoads,
      loadEvents: window.__frameLoadEvents - initialLoadEvents,
      frameVisible: frame?.hidden === false,
      statusHidden: document.getElementById("codex-taskboard-status")?.hidden === true,
      hostDocumentUnchanged: performance.timeOrigin === initialTimeOrigin && location.href === initialUrl,
    };
  };

  let result;
  if (scenario === "mutation") {
    const unrelated = document.getElementById("result");
    for (let index = 0; index < 5; index += 1) {
      unrelated.className = `unrelated-${index}`;
      unrelated.setAttribute("aria-label", `Unrelated ${index}`);
    }
    await wait(600);
    result = { afterMutation: snapshot() };
  } else if (scenario === "remount") {
    const surface = document.getElementById("surface");
    const replacement = document.createElement("div");
    replacement.id = "surface";
    replacement.appendChild(surface.querySelector("[data-app-shell-main-content-layout]").cloneNode(true));
    surface.replaceWith(replacement);
    await waitUntil(() => window.__loadFrameRequests > initialLoads
      && window.__codexTaskboardInjection__.ready);
    await wait(600);
    result = {
      afterReplacement: snapshot(),
      pageMountedOnReplacement: document.getElementById("codex-taskboard-page")?.parentElement === replacement,
    };
    await wait(600);
    result.afterSettling = snapshot();
  } else if (scenario === "heartbeat") {
    stopHeartbeat();
    // Deliver any already-posted heartbeat, then exceed the production 8 s age limit.
    await wait(0);
    await wait(8_200);
    result = { afterIdle: snapshot() };
    window.__codexTaskboardInjection__.open();
    await waitUntil(() => document.getElementById("codex-taskboard-status")?.hidden === false);
    await wait(400);
    result.afterReopen = snapshot();
    result.errorText = document.getElementById("codex-taskboard-status")?.textContent;
  } else {
    throw new Error(`Unknown frame lifecycle scenario: ${scenario}`);
  }
  return { initialLoads, initialLoadEvents, ...result, injectionError: window.__injectionError };
}

function fixtureHtml(origin, scenario) {
  const encodedSource = Buffer.from(source).toString("base64");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body { width: 1200px; height: 800px; margin: 0; }
      aside { position: absolute; width: 200px; height: 800px; }
      main { position: absolute; left: 200px; width: 1000px; height: 700px; }
      main > header { position: absolute; z-index: 2; width: 1000px; height: 48px; }
      #surface { width: 1000px; height: 700px; }
      [data-app-shell-main-content-layout] { position: absolute; width: 1000px; height: 700px; }
      #conversation { position: absolute; top: 48px; width: 1000px; height: 652px; }
      [data-browser-sidebar-webview] { position: absolute; right: 0; width: 320px; height: 700px; visibility: visible; }
    </style>
  </head>
  <body>
    <aside>
      <nav role="navigation">
        <div data-app-action-sidebar-scroll>
          <div>
            <button><span>首页</span></button>
            <button><span>站点</span></button>
            <button><svg></svg><span class="text-fade-truncate">插件</span></button>
          </div>
          <section data-app-action-sidebar-section>
            <div data-app-action-sidebar-section-heading="项目">项目</div>
          </section>
        </div>
      </nav>
    </aside>
    <main>
      <header>Codex header</header>
      <div id="surface">
        <div data-app-shell-main-content-layout>
          <div id="conversation">Conversation</div>
        </div>
      </div>
      <div data-browser-sidebar-webview>
        <webview
          data-browser-sidebar-conversation-id="conversation-1"
          data-browser-sidebar-browser-tab-id="browser-tab-1"
        ></webview>
      </div>
    </main>
    <output id="result"></output>
    <script>
      window.__CODEX_TASKBOARD_URL__ = ${JSON.stringify(`${origin}/taskboard?host=codex`)};
      window.__CODEX_TASKBOARD_INSTANCE_TOKEN__ = ${JSON.stringify(instanceToken)};
      window.__CODEX_TASKBOARD_INSTANCE_SECRET__ = ${JSON.stringify(instanceSecret)};
      window.__CODEX_TASKBOARD_HOST_CAPABILITY__ = "fullheight-host-capability";
      window.__CODEX_TASKBOARD_SOURCE_HASH__ = "fullheight-regression";
      window.__fixtureScenario = ${JSON.stringify(scenario)};
      window.__loadFrameRequests = 0;
      window.__frameLoadEvents = 0;
      window.__browserPanelClosed = false;
      window.__injectionError = null;
      window.__frameMessages = [];
      window.__externalOpenUrl = null;
      window.__frameVisibleBeforeNavigation = false;
      window.__statusHiddenBeforeNavigation = false;
      window.__hostileNavigationLoaded = false;
      window.__forgedThreadOpened = false;
      window.addEventListener("error", (event) => {
        window.__injectionError = event.error?.stack || event.message;
      });
      window.addEventListener("unhandledrejection", (event) => {
        window.__injectionError = event.reason?.stack || String(event.reason);
      });
      window.addEventListener("message", (event) => {
        if (typeof event.data?.type === "string" && event.data.type.startsWith("taskboard:")) {
          window.__frameMessages.push({ type: event.data.type, origin: event.origin });
        }
        if (
          event.source === window
          && event.data?.type === "__codexTaskboardHostRequestV1"
          && event.data.capability === "fullheight-host-capability"
        ) {
          const request = event.data.payload;
          if (request.action === "load-frame") {
            window.__loadFrameRequests += 1;
            const frame = document.querySelector('iframe[name="' + request.frameName + '"]');
            frame.addEventListener("load", () => { window.__frameLoadEvents += 1; });
            frame.srcdoc = '<a id="external-link" href="https://example.com/review" target="_blank">Review</a>'
              + '<script>'
              + ${JSON.stringify(embeddedHostClassicSource)}
              + '\\nglobalThis.__CODEX_TASKBOARD_FRAME_CAPABILITY__='
              + JSON.stringify(request.frameCapability)
              + ';installEmbeddedExternalLinkHandler();'
              + 'let activated=false,acknowledgedChallenge="";window.addEventListener("message",function(event){'
              + 'if(event.data?.type!=="taskboard:frame-challenge")return;'
              + 'const challenge=event.data.payload?.challenge;if(!challenge||challenge===acknowledgedChallenge)return;'
              + 'acknowledgedChallenge=challenge;setEmbeddedFrameChallenge(challenge);'
              + 'postEmbeddedHostMessage({type:"taskboard:ready"});'
              + 'if(activated)return;activated=true;'
              + ${JSON.stringify(scenario === "security" ? "" : "return;")}
              + 'parent.postMessage({type:"taskboard:ready"},"*");'
              + 'parent.postMessage({type:"taskboard:open-thread",payload:{threadId:"forged"}},"*");'
              + 'document.getElementById("external-link").click();'
              + '});postEmbeddedHostMessage({type:"taskboard:frame-awaiting-challenge"});<\\/script>';
          }
          if (request.action === "open-external") {
            window.__externalOpenUrl = request.url;
            const frame = document.getElementById("codex-taskboard-frame");
            window.__frameVisibleBeforeNavigation = frame?.hidden === false;
            window.__statusHiddenBeforeNavigation = document.getElementById("codex-taskboard-status")?.hidden === true;
            frame?.addEventListener("load", () => {
              window.__hostileNavigationLoaded = true;
              window.__resolveHostileNavigationLoaded();
            }, { once: true });
            frame.removeAttribute("srcdoc");
            frame.src = ${JSON.stringify(`${origin}/attacker`)};
          }
          window.postMessage({
            type: "__codexTaskboardHostResponseV1",
            capability: "fullheight-host-capability",
            response: { id: request.id, ok: true, loaded: true },
          }, window.location.origin);
        }
        if (event.source === window && event.data?.type === "navigate-to-route") {
          window.__forgedThreadOpened = true;
        }
        if (event.data?.type !== "toggle-browser-panel" || event.data.open !== false) return;
        const panel = document.querySelector("[data-browser-sidebar-webview]");
        panel.style.visibility = "hidden";
        panel.hidden = true;
        const conversation = document.getElementById("conversation");
        conversation.style.top = "0";
        conversation.style.height = "700px";
        window.__browserPanelClosed = true;
      });
    </script>
    <script>eval(atob(${JSON.stringify(encodedSource)}));</script>
    <script>
      (async () => {
        const publishHeartbeat = () => window.postMessage({
            type: "__codexTaskboardHostHeartbeatV1",
            capability: "fullheight-host-capability",
            at: Date.now(),
            startupToken: "fullheight-startup",
          }, window.location.origin);
        publishHeartbeat();
        const heartbeatTimer = setInterval(publishHeartbeat, 500);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const entry = document.getElementById("codex-taskboard-entry");
        const panel = document.querySelector("[data-browser-sidebar-webview]");
        const panelVisibleBefore = getComputedStyle(panel).visibility !== "hidden";
        const hostileNavigationLoaded = new Promise((resolve) => {
          window.__resolveHostileNavigationLoaded = resolve;
        });
        entry?.click();
        if (window.__fixtureScenario !== "security") {
          const report = (result) => {
            const bytes = new TextEncoder().encode(JSON.stringify(result));
            document.getElementById("result").textContent = btoa(String.fromCharCode(...bytes));
          };
          try {
            const result = await (${observeFrameLifecycle.toString()})(window.__fixtureScenario, () => clearInterval(heartbeatTimer));
            report(result);
          } catch (error) {
            report({ fixtureError: error.stack || String(error) });
          } finally {
            clearInterval(heartbeatTimer);
            window.__codexTaskboardInjection__?.destroy();
          }
          return;
        }
        await hostileNavigationLoaded;

        const page = document.getElementById("codex-taskboard-page");
        const frame = document.getElementById("codex-taskboard-frame");
        const surface = document.getElementById("surface");
        const conversation = document.getElementById("conversation");
        const result = {
          panelVisibleBefore,
          browserPanelClosed: window.__browserPanelClosed,
          conversationTop: conversation.getBoundingClientRect().top,
          pageMounted: page?.parentElement === surface,
          pageVisible: Boolean(page && !page.hidden && getComputedStyle(page).display !== "none"),
          frameMounted: frame?.parentElement === page,
          frameVisible: Boolean(frame && !frame.hidden && getComputedStyle(frame).display !== "none"),
          frameIsolated: frame?.contentDocument === null,
          statusHidden: document.getElementById("codex-taskboard-status")?.hidden === true,
          frameMessages: window.__frameMessages,
          externalOpenUrl: window.__externalOpenUrl,
          frameVisibleBeforeNavigation: window.__frameVisibleBeforeNavigation,
          statusHiddenBeforeNavigation: window.__statusHiddenBeforeNavigation,
          hostileNavigationRevoked: Boolean(frame?.hidden && !document.getElementById("codex-taskboard-status")?.hidden),
          forgedThreadOpened: window.__forgedThreadOpened,
          injectionError: window.__injectionError,
        };
        document.getElementById("result").textContent = btoa(JSON.stringify(result));
        clearInterval(heartbeatTimer);
        window.__codexTaskboardInjection__?.destroy();
      })();
    </script>
  </body>
</html>`;
}

async function runFixture(t, scenario) {
  const chrome = await chromeExecutable();
  if (!chrome) {
    t.skip("Chrome or Chromium is not installed");
    return;
  }

  const server = http.createServer((request, response) => {
    response.setHeader("connection", "close");
    if (request.url === "/attacker") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<!doctype html><title>attacker</title>");
      return;
    }
    if (request.url?.startsWith("/taskboard")) {
      response.setHeader("access-control-allow-origin", "null");
      response.setHeader("access-control-expose-headers", "x-codex-taskboard-proof");
      response.setHeader("access-control-allow-private-network", "true");
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      const challenge = new URL(request.url, "http://127.0.0.1")
        .searchParams.get("__codex_taskboard_challenge");
      response.setHeader(
        "x-codex-taskboard-proof",
        createHmac("sha256", instanceSecret).update(challenge).digest("hex"),
      );
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html><head></head><body><script>parent.postMessage({ type: "taskboard:ready" }, "*")</script></body></html>`);
      return;
    }
    const origin = `http://127.0.0.1:${server.address().port}`;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(fixtureHtml(origin, scenario));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(() => {
      assert.equal(server.listening, false);
      t.diagnostic("Closed isolated loopback fixture server");
      resolve();
    });
    server.closeAllConnections();
  }));

  const profile = await mkdtemp(path.join(os.tmpdir(), "taskboard-fullheight-chrome-"));
  t.after(async () => {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await assert.rejects(access(profile), { code: "ENOENT" });
    t.diagnostic(`Removed isolated Chrome profile: ${profile}`);
  });
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--user-data-dir=${profile}`,
    "--remote-debugging-pipe",
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  const browser = new CdpPipeBrowser(child);
  let session;
  let encodedResult = "";
  try {
    await browser.open();
    const target = (await browser.targets()).find(({ type }) => type === "page");
    assert.ok(target, "Chrome did not expose a page target");
    session = await browser.connect(target.targetId);
    await session.send("Page.enable");
    await session.send("Runtime.enable");
    const loaded = session.waitFor("Page.loadEventFired", 10_000);
    await session.send("Page.navigate", { url });
    await loaded;

    const deadline = Date.now() + 20_000;
    while (!encodedResult && Date.now() < deadline) {
      const evaluation = await session.send("Runtime.evaluate", {
        expression: 'document.getElementById("result")?.textContent || ""',
        returnByValue: true,
      });
      encodedResult = evaluation.result.value;
      if (!encodedResult) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    session?.close();
    browser.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null, "Owned Chrome child did not exit");
    t.diagnostic(`Owned Chrome child ${child.pid} exited (${child.signalCode || child.exitCode})`);
  }

  assert.ok(encodedResult, "fixture did not report an injection result");
  return JSON.parse(Buffer.from(encodedResult, "base64").toString("utf8"));
}

test("Taskboard fills the workspace, opens HTTPS links and revokes hostile iframe navigation", async (t) => {
  const result = await runFixture(t, "security");
  if (!result) return;
  assert.deepEqual(result, {
    panelVisibleBefore: true,
    browserPanelClosed: true,
    conversationTop: 0,
    pageMounted: true,
    pageVisible: true,
    frameMounted: true,
    frameVisible: false,
    frameIsolated: true,
    statusHidden: false,
    frameMessages: [
      { type: "taskboard:frame-awaiting-challenge", origin: "null" },
      { type: "taskboard:ready", origin: "null" },
      { type: "taskboard:ready", origin: "null" },
      { type: "taskboard:open-thread", origin: "null" },
      { type: "taskboard:open-external", origin: "null" },
    ],
    externalOpenUrl: "https://example.com/review",
    frameVisibleBeforeNavigation: true,
    statusHiddenBeforeNavigation: true,
    hostileNavigationRevoked: true,
    forgedThreadOpened: false,
    injectionError: null,
  });
});

function assertUnchangedFrame(snapshot, { frameVisible = true, statusHidden = true } = {}) {
  assert.deepEqual(snapshot, {
    sameFrame: true,
    sameWindow: true,
    sameName: true,
    loadRequests: 0,
    loadEvents: 0,
    frameVisible,
    statusHidden,
    hostDocumentUnchanged: true,
  });
}

test("unrelated DOM mutations preserve the ready iframe and do not load another document", async (t) => {
  const result = await runFixture(t, "mutation");
  if (!result) return;
  assert.equal(result.fixtureError, undefined);
  assert.ok(result.initialLoads > 0);
  assert.ok(result.initialLoadEvents > 0);
  assert.equal(result.injectionError, null);
  assertUnchangedFrame(result.afterMutation);
});

test("replacing the host surface rebuilds the iframe exactly once after mutations settle", async (t) => {
  const result = await runFixture(t, "remount");
  if (!result) return;
  assert.equal(result.fixtureError, undefined);
  assert.ok(result.initialLoads > 0);
  assert.ok(result.initialLoadEvents > 0);
  assert.equal(result.injectionError, null);
  assert.equal(result.pageMountedOnReplacement, true);
  assert.equal(result.afterReplacement.sameFrame, false);
  assert.equal(result.afterReplacement.sameWindow, false);
  assert.equal(result.afterReplacement.sameName, false);
  assert.equal(result.afterReplacement.loadRequests, 1);
  assert.ok(result.afterReplacement.loadEvents > 0);
  assert.equal(result.afterReplacement.frameVisible, true);
  assert.equal(result.afterReplacement.statusHidden, true);
  assert.equal(result.afterReplacement.hostDocumentUnchanged, true);
  assert.deepEqual(result.afterSettling, result.afterReplacement);
});

test("expired idle heartbeat preserves the iframe and reopening only shows a host error", async (t) => {
  const result = await runFixture(t, "heartbeat");
  if (!result) return;
  assert.equal(result.fixtureError, undefined);
  assert.ok(result.initialLoads > 0);
  assert.ok(result.initialLoadEvents > 0);
  assert.equal(result.injectionError, null);
  assertUnchangedFrame(result.afterIdle);
  assertUnchangedFrame(result.afterReopen, { frameVisible: false, statusHidden: false });
  assert.match(result.errorText, /任务面板服务未就绪|Taskboard service is not ready/);
});
