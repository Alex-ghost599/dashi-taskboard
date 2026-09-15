import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { discoverNodeTests } from "./source-discovery.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = await discoverNodeTests(path.join(root, "test"));
const child = spawn(process.execPath, ["--test", ...tests], {
  cwd: root, stdio: "inherit",
});
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
