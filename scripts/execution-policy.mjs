#!/usr/bin/env node
// Operator-only local control entry. Never exposed through taskctl or the task HTTP API.
import { readFileSync, statSync } from "node:fs";
import { ExecutionPolicyStore } from "../server/execution-policy-store.mjs";
import { previewExecutionPolicy, validateExecutionPolicy } from "../server/execution-policy.mjs";

const help = `Usage: node scripts/execution-policy.mjs <get|replace|pause|preview>
  --store <absolute control.sqlite> --project <project-id>
  replace: --expected-revision <integer> --file <policy.json>
  pause:   --expected-revision <integer>
  preview: --expected-revision <integer> --file <request.json>

Local policy management/preflight only. No model calls, scheduled changes or dispatch.
Preview never authorizes dispatch. Pause does not stop existing tasks or old scheduled.
The future coordinator must enforce live policy, budget and adapter permissions.
`;
let store;
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === undefined) {
    process.stdout.write(help);
  } else {
    if (!["get", "replace", "pause", "preview"].includes(command)) throw new Error("Unknown command");
    const keys = ["--store", "--project", ...(command === "get" ? [] : ["--expected-revision"]),
      ...(["replace", "preview"].includes(command) ? ["--file"] : [])];
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i]; const value = args[i + 1];
      if (!keys.includes(key) || Object.hasOwn(options, key) || !value) throw new Error("Unknown, duplicate or missing option");
      options[key] = value;
    }
    if (keys.some((key) => !Object.hasOwn(options, key))) throw new Error("Required option missing; use --help");
    const project = options["--project"];
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(project)) throw new Error("Invalid project identifier");
    const expectedRevision = Number(options["--expected-revision"]);
    if (command !== "get" && (!/^(0|[1-9][0-9]*)$/.test(options["--expected-revision"]) || !Number.isSafeInteger(expectedRevision))) throw new Error("Invalid expected revision");
    let input;
    if (options["--file"]) {
      if (statSync(options["--file"]).size > 64 * 1024) throw new Error("Input exceeds 64 KiB");
      input = JSON.parse(readFileSync(options["--file"], "utf8"));
    }
    // Reject malformed policy before creating any control store.
    if (command === "replace") {
      input = validateExecutionPolicy(input);
      if (input.projectId !== project) throw new Error("Policy project differs from selected project");
    }
    store = new ExecutionPolicyStore(options["--store"], { readOnly: command === "get" || command === "preview", createIfMissing: command === "replace" });
    const result = command === "get" ? (store.get(project) ?? { policy: null })
      : command === "replace" ? store.replace(project, expectedRevision, input)
        : command === "pause" ? store.pause(project, expectedRevision)
          : previewExecutionPolicy(store.get(project), input, { expectedRevision });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
} finally { store?.close(); }
