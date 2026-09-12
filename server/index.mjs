import os from "node:os";
import { pathToFileURL } from "node:url";

import { createTaskboardServer, resolveHost, resolvePort } from "./app.mjs";

export { createTaskboardServer, resolveHost, resolvePort, resolveServerOptions } from "./app.mjs";

async function main() {
  const personal = process.env.CODEX_TASKBOARD_PERSONAL_MODE === "1";
  const owned = personal && process.env.CODEX_TASKBOARD_PARENT_PIPE === "1";
  let parentLost = () => process.exit(0);
  if (owned) {
    // This pipe is owned by the spawning App; EOF also covers an App crash.
    // Install before async startup so an abandoned startup cannot leave a service.
    process.stdin.once("end", () => parentLost());
    process.stdin.once("error", () => parentLost());
    process.stdin.resume();
  }
  if (personal) {
    if (!process.env.CODEX_TASKBOARD_DATA_DIR || resolveHost() !== "127.0.0.1") {
      throw new Error("Personal service requires an explicit data directory and loopback host");
    }
    const { personalServiceCredentials } = await import("../shared/personal-service.mjs");
    const credentials = await personalServiceCredentials(process.env.CODEX_TASKBOARD_DATA_DIR, { create: true });
    process.env.CODEX_TASKBOARD_INSTANCE_TOKEN = credentials.token;
    process.env.CODEX_TASKBOARD_INSTANCE_SECRET = credentials.secret;
  }
  const app = createTaskboardServer({ personalRootRedirect: personal });
  const host = resolveHost();
  const listenFd = process.env.CODEX_TASKBOARD_LISTEN_FD === undefined
    ? null
    : Number(process.env.CODEX_TASKBOARD_LISTEN_FD);
  const address = await app.listen({ host, port: resolvePort(), fd: listenFd });
  console.log(owned
    ? JSON.stringify({ event: "personal-ready", port: address.port })
    : `Codex Taskboard listening on http://127.0.0.1:${address.port}`);
  if (host === "0.0.0.0") {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry?.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);
    for (const lanAddress of [...new Set(addresses)]) {
      console.log(`Codex Taskboard available on LAN at http://${lanAddress}:${address.port}`);
    }
  }

  let closePromise;
  const close = () => (closePromise ??= app.close());
  parentLost = () => {
    // No parent remains to enforce its five-second deadline. Limit our own drain.
    setTimeout(() => process.exit(1), 5000).unref();
    close().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
  };
  process.once("SIGINT", () => close().then(() => process.exit(0)));
  process.once("SIGTERM", () => close().then(() => process.exit(0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
