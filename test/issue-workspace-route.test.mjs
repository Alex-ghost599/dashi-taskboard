import assert from "node:assert/strict";
import { test } from "node:test";
import * as route from "../web/src/issueRoute.ts";

test("workspace parent URLs are stable and keep detail context within the project", () => {
  const nested = route.buildIssueUrl("http://localhost/?project=p1&theme=dark", "p1", null, "parent-a");
  assert.equal(nested.searchParams.get("parent"), "parent-a");
  assert.equal(route.readWorkspaceParentId(nested.search), "parent-a");
  const detail = route.buildIssueUrl(nested.href, "p1", "P1-2");
  assert.equal(detail.searchParams.get("parent"), "parent-a");
  const closed = route.buildIssueUrl(detail.href, "p1", null);
  assert.equal(closed.searchParams.get("parent"), "parent-a");
  assert.equal(closed.searchParams.get("theme"), "dark");
});

test("changing project or explicitly navigating root removes the old workspace parent", () => {
  const href = "http://localhost/?project=p1&parent=parent-a&issue=P1-2";
  assert.equal(route.buildIssueUrl(href, "p2", null).searchParams.has("parent"), false);
  assert.equal(route.buildIssueUrl(href, "p1", null, null).searchParams.has("parent"), false);
});

test("workspace parent parsing preserves case without silently treating unknown ids as root", () => {
  assert.equal(route.readWorkspaceParentId("?parent=Parent-a"), "Parent-a");
  assert.equal(route.readWorkspaceParentId("?parent=%20"), null);
  assert.equal(route.readWorkspaceParentId("?parent=" + "a".repeat(129)), "a".repeat(129));
});
