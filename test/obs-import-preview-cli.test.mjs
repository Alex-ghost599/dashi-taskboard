import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
const script = fileURLToPath(new URL("../scripts/obs-import-preview.mjs", import.meta.url));
test("CLI reads explicit synthetic files and leaves their bytes unchanged; invalid scope never emits candidates", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "obs-preview-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const markdown = "---\ntask_id: AGT-20260915-001\nagent: codex\nstatus: planned\nworkspace: /fixture/project\ncustom: 保留\n---\n# 验收样例\n";
  writeFileSync(path.join(dir, "a.md"), markdown);
  const manifest = { root: dir, files: ["a.md"], projects: [{ hostId: "local", projectId: "p1", workspacePath: "/fixture/project" }], scope: { from: "2026-09-01", through: "2026-09-30", statuses: ["planned"] } };
  const manifestPath = path.join(dir, "preview.json");
  const run = (input = manifest) => {
    writeFileSync(manifestPath, JSON.stringify(input));
    return spawnSync(process.execPath, [script, "--manifest", manifestPath], { encoding: "utf8" });
  };
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.rows[0].decision, "candidate");
  assert.equal(output.rows[0].proposed.sourceMarkdown, markdown);
  assert.equal(readFileSync(path.join(dir, "a.md"), "utf8"), markdown);
  assert.equal(output.authorizesImport, false);
  for (const input of [{ ...manifest, files: ["../outside.md"] }, { ...manifest, scope: undefined }]) {
    const invalid = run(input);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
  }
  symlinkSync(path.join(dir, "a.md"), path.join(dir, "link.md"));
  assert.equal(run({ ...manifest, files: ["link.md"] }).status, 1);
});


test("a parent replaced by an outside symlink immediately before open cannot leak source text", (t) => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "obs-preview-race-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "root");
  const parent = path.join(root, "nested");
  const outside = path.join(dir, "outside");
  mkdirSync(parent, { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(parent, "a.md"), "safe");
  writeFileSync(path.join(outside, "a.md"), "PRIVATE_OUTSIDE_SENTINEL");
  const preload = path.join(dir, "race.mjs");
  writeFileSync(preload, `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
const original = fs.openSync;
fs.openSync = function(file, ...args) {
 if (file === ${JSON.stringify(path.join(parent, "a.md"))}) {
  fs.renameSync(${JSON.stringify(parent)}, ${JSON.stringify(parent + "-old")});
  fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(parent)}, "dir");
 }
 return original.call(this, file, ...args);
}; syncBuiltinESMExports();`);
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ root, files: ["nested/a.md"], projects: [], scope: { from: "2026-09-01", through: "2026-09-30", statuses: ["planned"] } }));
  const result = spawnSync(process.execPath, ["--import", preload, script, "--manifest", manifest], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "SOURCE_CHANGED");
  assert.equal(existsSync(parent + "-old"), true);
  assert.equal((result.stderr + result.stdout).includes("PRIVATE_OUTSIDE_SENTINEL"), false);
});
