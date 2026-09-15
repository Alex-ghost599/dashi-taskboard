#!/usr/bin/env node
import { previewObsImport } from "../shared/obs-import-preview.mjs";
import { readObsSnapshot } from "../server/obs-snapshot-input.mjs";
try {
  if (process.argv.length !== 4 || process.argv[2] !== "--manifest") throw new Error("Usage: node scripts/obs-import-preview.mjs --manifest <explicit-preview.json>");
  const result = previewObsImport(readObsSnapshot(process.argv[3]));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "PREVIEW_FAILED";
  process.stderr.write(`${/^[A-Z_]+$/.test(message) || message.startsWith("Usage:") ? message : "PREVIEW_FAILED"}\n`);
  process.exitCode = 1;
}
