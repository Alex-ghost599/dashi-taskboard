import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveIssueWorkspace } from "../web/src/issueWorkspace.mjs";

function task(id, { projectId = "project-a", parentId = null, archivedAt = null } = {}) {
  return {
    id,
    identifier: `ISSUE-${id}`,
    projectId,
    title: `Title ${id}`,
    archivedAt,
    relations: {
      parent: parentId === null ? null : { id: parentId, projectId },
      subIssues: [],
      blockedBy: [],
      blocks: [],
      related: [],
    },
  };
}

function assertUnavailable(result, code) {
  assert.equal(result.state, "unavailable");
  assert.equal(result.code, code);
  assert.equal(result.parent, null);
  assert.deepEqual(result.breadcrumbs, []);
  assert.deepEqual(result.taskIds, []);
  assert.equal(result.readOnly, true);
}

test("project root contains only its roots, keeping archived roots and hiding every child level", () => {
  const tasks = [
    task("root-2"),
    task("child", { parentId: "root-1" }),
    task("other-root", { projectId: "project-b" }),
    task("root-1", { archivedAt: "2026-10-01T00:00:00Z" }),
    task("grandchild", { parentId: "child" }),
    task("orphan", { parentId: "missing" }),
  ];
  assert.deepEqual(resolveIssueWorkspace(tasks, "project-a", null), {
    state: "root", parent: null, breadcrumbs: [],
    taskIds: ["root-2", "root-1"], readOnly: false, code: null,
  });
});

test("All Projects preserves every task ID in the existing flat order", () => {
  const tasks = [task("child", { parentId: "missing" }), task("other", { projectId: "project-b" }), task("root")];
  assert.deepEqual(resolveIssueWorkspace(tasks, null, null), {
    state: "root", parent: null, breadcrumbs: [],
    taskIds: ["child", "other", "root"], readOnly: false, code: null,
  });
});

test("nested workspace contains direct children only, excluding its parent, grandchildren, and other projects", () => {
  const parent = task("parent");
  const tasks = [
    task("second", { parentId: "parent" }), parent,
    task("grandchild", { parentId: "first" }),
    task("foreign-child", { projectId: "project-b", parentId: "parent" }),
    task("first", { parentId: "parent", archivedAt: "2026-10-01T00:00:00Z" }),
    task("sibling"),
  ];
  const result = resolveIssueWorkspace(tasks, "project-a", "parent");
  assert.equal(result.state, "nested");
  assert.deepEqual(result.taskIds, ["second", "first"]);
  assert.equal(result.parent, parent);
  assert.equal(result.readOnly, false);
  assert.equal(result.code, null);
});

test("breadcrumbs use the complete task records in highest-ancestor to selected-parent order", () => {
  const tasks = [task("leaf", { parentId: "middle" }), task("top"), task("middle", { parentId: "top" })];
  const result = resolveIssueWorkspace(tasks, "project-a", "leaf");
  assert.equal(result.state, "nested");
  assert.deepEqual(result.breadcrumbs, [
    { id: "top", identifier: "ISSUE-top", title: "Title top", archivedAt: null },
    { id: "middle", identifier: "ISSUE-middle", title: "Title middle", archivedAt: null },
    { id: "leaf", identifier: "ISSUE-leaf", title: "Title leaf", archivedAt: null },
  ]);
  assert.deepEqual(result.taskIds, []);
});

test("a missing selected parent is unavailable even when child summaries reference it", () => {
  assertUnavailable(resolveIssueWorkspace([task("child", { parentId: "missing" })], "project-a", "missing"), "parent-not-found");
});

test("a parent workspace requires an explicit project instead of using All Projects", () => {
  assertUnavailable(resolveIssueWorkspace([task("parent")], null, "parent"), "project-required");
});

test("a selected parent belonging to another project cannot resolve", () => {
  assertUnavailable(resolveIssueWorkspace([task("parent", { projectId: "project-b" })], "project-a", "parent"), "project-mismatch");
});

test("a missing ancestor refuses navigation rather than falling back to root", () => {
  const tasks = [task("parent", { parentId: "missing" }), task("child", { parentId: "parent" }), task("root")];
  assertUnavailable(resolveIssueWorkspace(tasks, "project-a", "parent"), "ancestor-not-found");
});

test("a cross-project ancestor refuses navigation using complete task ownership", () => {
  const tasks = [task("parent", { parentId: "foreign" }), task("foreign", { projectId: "project-b" })];
  assertUnavailable(resolveIssueWorkspace(tasks, "project-a", "parent"), "ancestor-project-mismatch");
});

test("a self-parent and a multi-task parent cycle are unavailable", () => {
  for (const tasks of [[task("a", { parentId: "a" })], [task("a", { parentId: "b" }), task("b", { parentId: "a" })]]) {
    assertUnavailable(resolveIssueWorkspace(tasks, "project-a", "a"), "parent-cycle");
  }
});

test("a valid 1000-level chain resolves while the next level is explicitly unavailable", () => {
  const tasks = Array.from({ length: 1001 }, (_, index) => task(String(index), { parentId: index === 0 ? null : String(index - 1) }));
  const valid = resolveIssueWorkspace(tasks, "project-a", "999");
  assert.equal(valid.state, "nested");
  assert.equal(valid.breadcrumbs.length, 1000);
  assert.equal(valid.breadcrumbs[0].id, "0");
  assert.equal(valid.breadcrumbs.at(-1).id, "999");
  assertUnavailable(resolveIssueWorkspace(tasks, "project-a", "1000"), "parent-depth-exceeded");
});

test("an archived selected parent remains browsable and marks the workspace read-only", () => {
  const parent = task("parent", { archivedAt: "2026-10-01T00:00:00Z" });
  const result = resolveIssueWorkspace([parent, task("child", { parentId: "parent" })], "project-a", "parent");
  assert.equal(result.state, "nested");
  assert.equal(result.parent, parent);
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.taskIds, ["child"]);
  assert.equal(result.breadcrumbs[0].archivedAt, "2026-10-01T00:00:00Z");
});

test("an archived ancestor makes a live descendant workspace read-only without blocking browsing", () => {
  const tasks = [
    task("top", { archivedAt: "2026-10-01T00:00:00Z" }),
    task("parent", { parentId: "top" }),
    task("child", { parentId: "parent" }),
  ];
  const result = resolveIssueWorkspace(tasks, "project-a", "parent");
  assert.equal(result.state, "nested");
  assert.equal(result.readOnly, true);
  assert.deepEqual(result.taskIds, ["child"]);
  assert.equal(result.breadcrumbs[0].archivedAt, "2026-10-01T00:00:00Z");
  assert.equal(result.breadcrumbs[1].archivedAt, null);
});

test("resolving frozen inputs preserves the original array, task ownership, and parent relationships", () => {
  const tasks = [task("parent"), task("child", { parentId: "parent" }), task("other", { projectId: "project-b" })];
  const before = structuredClone(tasks);
  for (const entry of tasks) {
    Object.freeze(entry.relations.parent);
    Object.freeze(entry.relations);
    Object.freeze(entry);
  }
  Object.freeze(tasks);
  const result = resolveIssueWorkspace(tasks, "project-a", "parent");
  assert.equal(result.state, "nested");
  assert.equal(result.parent, tasks[0]);
  result.breadcrumbs[0].title = "caller-local label";
  result.taskIds.push("caller-local ID");
  assert.deepEqual(tasks, before);
});
