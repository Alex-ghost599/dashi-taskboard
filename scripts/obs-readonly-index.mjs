#!/usr/bin/env node
import { ObsReadonlyIndex } from "../server/obs-readonly-index.mjs";
import { readObsSnapshot } from "../server/obs-snapshot-input.mjs";
let db;
try {
  const [command, ...args] = process.argv.slice(2);
  const allowed = command === "ingest" ? ["--database", "--manifest", "--operation", "--expected-revision"] : command === "list" ? ["--database", "--source-root"] : [];
  if (!allowed.length || args.length !== allowed.length * 2) throw new Error("INVALID_ARGUMENTS");
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || values.has(args[i])) throw new Error("INVALID_ARGUMENTS");
    values.set(args[i], args[i + 1]);
  }
  let result;
  if (command === "ingest") {
    const value = values.get("--expected-revision");
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("INVALID_REVISION");
    const snapshot = readObsSnapshot(values.get("--manifest"));
    db = new ObsReadonlyIndex(values.get("--database"), snapshot.sourceRoot);
    result = db.apply({ operationId: values.get("--operation"), expectedRevision: Number(value), snapshot });
  } else {
    db = new ObsReadonlyIndex(values.get("--database"), values.get("--source-root"), { readOnly: true });
    result = db.list();
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${/^[A-Z_]+$/.test(error?.message ?? "") ? error.message : "INDEX_FAILED"}\n`);
  process.exitCode = 1;
} finally { db?.close(); }
