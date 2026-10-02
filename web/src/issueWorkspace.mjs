function unavailable(code) {
  return {
    state: "unavailable",
    parent: null,
    breadcrumbs: [],
    taskIds: [],
    readOnly: true,
    code,
  };
}

/**
 * Resolve one hierarchy level from the complete task list, including archived tasks.
 * Task records remain authoritative for project ownership and ancestor traversal.
 */
export function resolveIssueWorkspace(tasks, projectId, parentId) {
  if (parentId === null) {
    return {
      state: "root",
      parent: null,
      breadcrumbs: [],
      taskIds: tasks
        .filter((task) => projectId === null || (task.projectId === projectId && task.relations.parent === null))
        .map((task) => task.id),
      readOnly: false,
      code: null,
    };
  }

  if (projectId === null) return unavailable("project-required");
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const parent = tasksById.get(parentId);
  if (!parent) return unavailable("parent-not-found");
  if (parent.projectId !== projectId) return unavailable("project-mismatch");

  const breadcrumbs = [];
  const seen = new Set();
  let current = parent;
  while (true) {
    if (seen.has(current.id)) return unavailable("parent-cycle");
    if (breadcrumbs.length >= 1000) return unavailable("parent-depth-exceeded");
    if (current.projectId !== projectId) return unavailable("ancestor-project-mismatch");
    seen.add(current.id);
    breadcrumbs.push({
      id: current.id,
      identifier: current.identifier,
      title: current.title,
      archivedAt: current.archivedAt,
    });
    const ancestorId = current.relations.parent?.id;
    if (ancestorId === undefined) break;
    const ancestor = tasksById.get(ancestorId);
    if (!ancestor) return unavailable("ancestor-not-found");
    current = ancestor;
  }
  breadcrumbs.reverse();

  return {
    state: "nested",
    parent,
    breadcrumbs,
    taskIds: tasks
      .filter((task) => task.projectId === projectId && task.relations.parent?.id === parentId)
      .map((task) => task.id),
    readOnly: breadcrumbs.some((breadcrumb) => breadcrumb.archivedAt !== null),
    code: null,
  };
}
