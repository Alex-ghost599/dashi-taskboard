import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCloudWorkerHarness } from "./helpers/cloud-worker-harness.mjs";
import { selectNodeTests, selectMigrations } from "../scripts/source-discovery.mjs";

test("test discovery selects canonical test modules and excludes duplicate copies and helpers", () => {
  const selected = selectNodeTests(["b.test.mjs", "a.test.mjs", "a.test 2.mjs", "a 2.test.mjs", "helpers", "helper.mjs", "fixture.test.mjs.bak"]);
  assert.deepEqual(selected, ["a.test.mjs", "b.test.mjs"]);
});

test("migration discovery preserves distinct same-number migrations and excludes copied SQL", () => {
  assert.deepEqual(selectMigrations(["0009_project_readmes.sql", "0009_remove_workflow_schema.sql", "0002_add_start_date 2.sql", "0001_initial.sql", "README.md"]),
    ["0001_initial.sql", "0009_project_readmes.sql", "0009_remove_workflow_schema.sql"]);
});

test("discovery rejects empty suites and unsafe path entries", () => {
  assert.throws(() => selectNodeTests(["a.test 2.mjs"]), /No canonical/);
  assert.throws(() => selectMigrations(["0001_initial 2.sql"]), /No canonical/);
  for (const value of ["../a.test.mjs", "nested/a.test.mjs", "nested\\a.test.mjs"]) {
    assert.throws(() => selectNodeTests([value]), /Invalid source entry/);
  }
});

const run = promisify(execFile);

test("canonical runner ignores an extra failing copy but reports a real test failure", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "test-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "test"));
  for (const name of ["run-node-tests.mjs", "source-discovery.mjs"]) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), path.join(root, "scripts", name));
  }
  await mkdir(path.join(root, "test", "nested"));
  await writeFile(path.join(root, "test", "nested", "new_case.test.mjs"), 'import test from "node:test"; test("nested fixture", () => {});');
  const canonical = path.join(root, "test", "a.test.mjs");
  await writeFile(canonical, 'import test from "node:test"; test("canonical fixture", () => {});');
  await writeFile(path.join(root, "test", "a.test 2.mjs"), 'throw new Error("DUPLICATE_MUST_NOT_RUN");');
  const launcher = path.join(root, "scripts", "run-node-tests.mjs");
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  await assert.rejects(run(process.execPath, ["--test"], { timeout: 10000, env, cwd: root }),
    (error) => error.code === 1 && /DUPLICATE_MUST_NOT_RUN/.test(error.stdout));
  const success = await run(process.execPath, [launcher], { timeout: 10000, env });
  assert.match(success.stdout, /canonical fixture/);
  assert.match(success.stdout, /nested fixture/);
  assert.doesNotMatch(success.stdout, /DUPLICATE_MUST_NOT_RUN/);
  await writeFile(canonical, 'import test from "node:test"; test("canonical fixture", () => { throw new Error("REAL_FAILURE"); });');
  await assert.rejects(run(process.execPath, [launcher], { timeout: 10000, env }), (error) => error.code === 1 && /REAL_FAILURE/.test(error.stdout));
});

test("real cloud migration harness succeeds with an additional duplicate ALTER migration", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "migration-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migrations = path.join(root, "migrations");
  await cp(new URL("../cloud/migrations", import.meta.url), migrations, { recursive: true });
  await copyFile(path.join(migrations, "0002_add_start_date.sql"), path.join(migrations, "0002_add_start_date 2.sql"));
  const harness = await createCloudWorkerHarness({ migrationsPath: migrations });
  try {
    const result = await harness.db.prepare("PRAGMA table_info(tasks)").all();
    assert.equal(result.results.filter((column) => column.name === "start_date").length, 1);
    // The old broad selector would include this copy; executing it again really fails.
    const duplicateSql = await readFile(path.join(migrations, "0002_add_start_date 2.sql"), "utf8");
    await assert.rejects(harness.db.exec(duplicateSql), /duplicate column name/);
  } finally { await harness.dispose(); }
});

test("canonical migration errors still fail instead of being hidden as copies", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "migration-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migrations = path.join(root, "migrations");
  await cp(new URL("../cloud/migrations", import.meta.url), migrations, { recursive: true });
  await writeFile(path.join(migrations, "9999_invalid.sql"), "THIS IS INVALID SQL;");
  await assert.rejects(createCloudWorkerHarness({ migrationsPath: migrations }), /syntax error|SQLITE_ERROR/);
});


test("unexpected source-like names fail explicitly instead of hiding new work", () => {
  assert.throws(() => selectMigrations(["0001_initial.sql", "migration.sql"]), /Unsupported source name/);
  assert.throws(() => selectNodeTests(["a.test.mjs", "new case.test.mjs"]), /Unsupported source name/);
  assert.throws(() => selectNodeTests(["a.test.mjs", "new.test.js"]), /Unsupported source name/);
  for (const name of ["test.mjs", "test.js", "test.cjs", "foo_test.mjs", "foo.spec.mjs"]) {
    assert.throws(() => selectNodeTests(["a.test.mjs", name]), /Unsupported source name/);
  }
  assert.deepEqual(selectNodeTests(["new_case.test.mjs"]), ["new_case.test.mjs"]);
  assert.deepEqual(selectMigrations(["0012_add-index.sql"]), ["0012_add-index.sql"]);
});
