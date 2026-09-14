#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveAutomationModels } from "../shared/automation-model-policy.mjs";
import { executableCommand } from "../shared/executable-command.mjs";
import { withoutTaskboardLauncherEnvironment } from "../shared/codex-environment.mjs";

const help = `Usage: node scripts/automation-capabilities.mjs
  --codex <absolute trusted Codex executable> OR --catalog <saved catalog.json>
  [--executor-effort low|light|medium|high|xhigh|max|ultra]
  [--trusted-executor-effort <explicit operator override>]

Only reads a model catalog. Never starts a model turn or changes scheduled tasks.
Live mode invokes 'codex debug models', which may refresh or use the CLI cache.
Model selection is not an execution permit; adapter permissions remain unverified.
`;
try {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    process.stdout.write(help);
  } else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]; const value = args[i + 1];
      if (!["--codex", "--catalog", "--executor-effort", "--trusted-executor-effort"].includes(key)
        || Object.hasOwn(options, key) || !value) throw new Error("Unknown, duplicate or missing option");
      options[key] = value;
    }
    if (Boolean(options["--codex"]) === Boolean(options["--catalog"])) throw new Error("Choose exactly one catalog source");
    let catalog;
    if (options["--codex"]) {
      if (!path.isAbsolute(options["--codex"])) throw new Error("Codex executable must be an absolute trusted path");
      const command = executableCommand(options["--codex"], ["debug", "models"]);
      const result = await promisify(execFile)(command.executable, command.args, {
        env: withoutTaskboardLauncherEnvironment(process.env), timeout: 25_000,
        maxBuffer: 2 * 1024 * 1024, encoding: "utf8", windowsHide: true,
      });
      catalog = JSON.parse(result.stdout);
    } else {
      const source = await readFile(options["--catalog"]);
      if (source.byteLength > 2 * 1024 * 1024) throw new Error("Catalog exceeds 2 MiB");
      catalog = JSON.parse(source.toString("utf8"));
    }
    const selection = resolveAutomationModels(catalog,
      { executorEffort: options["--executor-effort"] ?? "low" },
      { trustedExecutorEffort: options["--trusted-executor-effort"] });
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1, observedAt: new Date().toISOString(),
      readiness: "waiting_for_adapter_validation", authorizesDispatch: false, selection,
      evidence: { catalogSource: options["--codex"] ? "codex_debug_models_may_use_cache" : "snapshot_file",
        modelGenerationVerified: false, judgeToolsVerified: false,
        bindingAndReceiptVerified: false, accountQuotaVerified: false },
    })}\n`);
  }
} catch {
  // Do not echo executable stderr or catalog payloads: provider/config output may be private.
  process.stdout.write(`${JSON.stringify({ error: "CAPABILITY_PROBE_FAILED", authorizesDispatch: false,
    message: "Check arguments, executable and catalog; no model fallback was attempted" })}\n`);
  process.exitCode = 1;
}
