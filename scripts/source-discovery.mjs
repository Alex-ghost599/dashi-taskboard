import { readdir } from "node:fs/promises";
import path from "node:path";

export const isNumberedCopy = (name) => / \d+(?=\.|$)/.test(name);
function select(entries, pattern, sourceLike, allowEmpty) {
  if (!Array.isArray(entries) || entries.some((name) => typeof name !== "string"
    || name.includes("/") || name.includes("\\") || name.includes("\0") || name === "." || name === "..")) {
    throw new Error("Invalid source entry");
  }
  const selected = [];
  for (const name of entries) {
    if (isNumberedCopy(name)) continue;
    if (pattern.test(name)) selected.push(name);
    else if (sourceLike.test(name)) throw new Error(`Unsupported source name: ${name}`);
  }
  if (!allowEmpty && selected.length === 0) throw new Error("No canonical source files found");
  return selected.sort();
}

// Only explicit space-number copies are skipped. Other source-like naming mistakes fail.
export const selectNodeTests = (entries, { allowEmpty = false } = {}) => select(entries,
  /^[a-z0-9][a-z0-9._-]*\.test\.mjs$/i, /(?:^test(?=[._-])|[._-](?:test|spec)(?=[._-])).*\.(?:mjs|cjs|js)$/i, allowEmpty);
export const selectMigrations = (entries) => select(entries,
  /^\d{4}_[a-z0-9_-]+\.sql$/i, /\.sql$/i, false);

export async function discoverNodeTests(root) {
  const tests = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const names = [];
    for (const entry of entries) {
      if (isNumberedCopy(entry.name) || entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isSymbolicLink()) throw new Error(`Test source symlink is unsupported: ${entry.name}`);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
      else if (entry.isFile()) names.push(entry.name);
    }
    tests.push(...selectNodeTests(names, { allowEmpty: true }).map((name) => path.join(directory, name)));
  }
  await visit(root);
  if (tests.length === 0) throw new Error("No canonical test files found");
  return tests.sort();
}
