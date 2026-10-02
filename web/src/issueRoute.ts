const ISSUE_QUERY_PARAM = "issue";
const WORKSPACE_PARENT_PARAM = "parent";

export function readWorkspaceParentId(search: string): string | null {
  const parentId = new URLSearchParams(search).get(WORKSPACE_PARENT_PARAM)?.trim();
  return parentId || null;
}

export function readIssueIdentifier(search: string): string | null {
  const identifier = new URLSearchParams(search).get(ISSUE_QUERY_PARAM)?.trim().toUpperCase();
  return identifier || null;
}

export function buildIssueUrl(
  href: string,
  projectId: string | null,
  issueIdentifier: string | null,
  workspaceParentId?: string | null,
): URL {
  const url = new URL(href);
  const previousProjectId = url.searchParams.get("project");

  if (projectId) url.searchParams.set("project", projectId);
  else url.searchParams.delete("project");

  if (issueIdentifier) url.searchParams.set(ISSUE_QUERY_PARAM, issueIdentifier.trim().toUpperCase());
  else url.searchParams.delete(ISSUE_QUERY_PARAM);

  if (workspaceParentId !== undefined) {
    if (workspaceParentId) url.searchParams.set(WORKSPACE_PARENT_PARAM, workspaceParentId);
    else url.searchParams.delete(WORKSPACE_PARENT_PARAM);
  } else if (previousProjectId !== projectId) {
    url.searchParams.delete(WORKSPACE_PARENT_PARAM);
  }

  return url;
}
