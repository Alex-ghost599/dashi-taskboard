import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../App";
import * as api from "../api";
import type { Project, Task } from "../types";
import { taskboardStorage, projectBoardDisplaySettingsStorageEntries, PROJECT_BOARD_DISPLAY_SETTINGS_KEY_PREFIX } from "../storage";

const realtime = vi.hoisted(() => ({ invalidate: () => {} }));
vi.mock("../revisionPolling.mjs", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createRevisionPoller: (options: { onInvalidate: () => void }) => {
    realtime.invalidate = options.onInvalidate;
    return { start() {}, stop() {} };
  },
}));
vi.mock("../storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../storage")>(),
  refreshProjectBoardDisplaySettingsStorage: vi.fn(async () => {}),
  projectBoardDisplaySettingsStorageEntries: vi.fn(() => []),
}));
// The chat panel has its own external lifecycle; the App's import prompt stays real.
vi.mock("./AiChat", () => ({ AiChat: () => null }));
// App view routing is under test; Gantt's canvas/layout lifecycle needs a real browser.
vi.mock("./GanttView", () => ({ GanttView: () => null }));
vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  listProjects: vi.fn(), listTasks: vi.fn(), listArchivedTasks: vi.fn(),
  getTaskboardMetadata: vi.fn(), listDeviceWorkspaces: vi.fn(),
  getJiraConnection: vi.fn(), listDevelopmentContexts: vi.fn(), getAiChatCatalog: vi.fn(), getProjectSummary: vi.fn(),
}));
const timestamp = "2026-10-02T00:00:00Z";
const projects: Project[] = [
  { id: "project-a", name: "Same name", workspacePath: "/synthetic/a", source: "local", labels: [], issueCount: 1, createdAt: timestamp, updatedAt: timestamp },
  { id: "project-b", name: "Same name", workspacePath: "/synthetic/b", source: "local", labels: [], issueCount: 0, createdAt: timestamp, updatedAt: timestamp },
];
function task(id: string, archived = false): Task {
  return {
    id, identifier: id, projectId: "project-a", title: id, description: "", status: "todo", priority: "none",
    labels: [], sortOrder: 0, threadId: null, threadBinding: null, legacyLocalThreadId: null,
    conversationRefs: [], participants: [], previewImage: null, activityKey: id, activityUpdatedAt: timestamp,
    creatorType: "user", creatorId: "synthetic", creatorName: "Synthetic", creatorAvatarUrl: null,
    assignee: { type: "user", id: "synthetic", name: "Synthetic", avatarUrl: null }, developmentContext: null,
    startDate: null, dueDate: null, recurrence: null, source: "local", externalUrl: null,
    archivedAt: archived ? timestamp : null,
    relations: { parent: null, subIssues: [], blockedBy: [], blocks: [], related: [] },
    version: 1, createdAt: timestamp, updatedAt: timestamp,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/?project=project-a&lang=en");
  taskboardStorage.removeItem("taskboard.project-view.v1.project-a");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
  vi.mocked(api.listProjects).mockResolvedValue(projects);
  vi.mocked(api.listTasks).mockImplementation(async (projectId) => projectId === "project-a" ? [task("Previous active card")] : []);
  vi.mocked(api.listArchivedTasks).mockImplementation(async (projectId) => projectId === "project-a" ? [task("Previous archived card", true)] : []);
  vi.mocked(api.getTaskboardMetadata).mockResolvedValue({ mode: "cloud", realtime: { transport: "poll", intervalMs: 60_000 }, capabilities: { localAiChat: true } });
  vi.mocked(api.listDeviceWorkspaces).mockResolvedValue({});
  vi.mocked(api.getJiraConnection).mockResolvedValue({ configured: false, baseUrl: null, username: null, displayName: null, projects: [], projectId: "jira-my-tasks", lastSyncedAt: null, insecureHttp: false });
  vi.mocked(api.listDevelopmentContexts).mockResolvedValue({ workspacePath: null, contexts: [] });
  vi.mocked(api.getAiChatCatalog).mockResolvedValue({ models: [], skills: [], sandboxes: [] });
  vi.mocked(api.getProjectSummary).mockResolvedValue({ projectId: "project-a", summary: null, updatedAt: null, refreshing: false, error: null });
  vi.mocked(projectBoardDisplaySettingsStorageEntries).mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function openProjectMenu() {
  const switcher = screen.getByRole("button", { name: "Switch project" });
  if (switcher.getAttribute("aria-expanded") !== "true") fireEvent.click(switcher);
  return screen.getByRole("menu", { name: "Projects" });
}
async function switchToB() {
  const menu = await openProjectMenu();
  const choices = within(menu).getAllByRole("menuitemradio").filter((item) => item.textContent?.includes("Same name"));
  fireEvent.click(choices[1]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Switch project" }).getAttribute("aria-expanded")).toBe("false"));
}
it("switching projects clears old active and archived cards while pending and after rejection", async () => {
  render(<App />);
  await screen.findByText("Previous active card");
  fireEvent.click(screen.getByRole("button", { name: "Open other issues" }));
  fireEvent.click(await screen.findByRole("tab", { name: /Archived/ }));
  await screen.findByText("Previous archived card");
  const pending = deferred<Task[]>();
  vi.mocked(api.listTasks).mockImplementation(async (projectId) => projectId === "project-b" ? pending.promise : []);
  await switchToB();
  expect(screen.queryByText("Previous active card")).toBeNull();
  expect(screen.queryByText("Previous archived card")).toBeNull();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
  await act(async () => pending.reject(new Error("Synthetic load failure")));
  expect(await screen.findByText("Synthetic load failure")).toBeTruthy();
  expect(screen.queryByText("Previous active card")).toBeNull();
  expect(screen.queryByText("Previous archived card")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Unable to load project issues" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
});
it("an archived-only project explains the existing archive without offering import", async () => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  render(<App />);
  expect(await screen.findByRole("heading", { name: "No active issues in this project" })).toBeTruthy();
  expect(screen.getByText(/1 archived issue/)).toBeTruthy();
  expect(screen.queryByText("This project has no issues yet")).toBeNull();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View archived issues" }));
  expect(await screen.findByText("Previous archived card")).toBeTruthy();
});
it("a confirmed empty project offers import, but a failed refresh removes that success prompt", async () => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(api.listArchivedTasks).mockResolvedValue([]);
  render(<App />);
  await screen.findByRole("heading", { name: "This project has no issues yet" });
  expect(screen.getByRole("button", { name: "Import current project task status" })).toBeTruthy();
  vi.mocked(api.listTasks).mockRejectedValue(new Error("Synthetic refresh failure"));
  act(() => realtime.invalidate());
  await screen.findByText("Synthetic refresh failure");
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Unable to load project issues" })).toBeTruthy();
});
it("same-project refresh retains valid cards while pending and after failure", async () => {
  render(<App />);
  await screen.findByText("Previous active card");
  const pending = deferred<Task[]>();
  vi.mocked(api.listTasks).mockImplementation(async (id) => id === "project-a" ? pending.promise : []);
  act(() => realtime.invalidate());
  expect(screen.getByText("Previous active card")).toBeTruthy();
  await act(async () => pending.reject(new Error("Same project refresh failure")));
  await screen.findByText("Same project refresh failure");
  expect(screen.getByText("Previous active card")).toBeTruthy();
});
it("duplicate project names expose their directory and ID in menu choices and selected title", async () => {
  render(<App />);
  await screen.findByText("Previous active card");
  const menu = await openProjectMenu();
  const a = within(menu).getByRole("menuitemradio", { name: /Same name.*\/synthetic\/a.*project-a/ });
  const b = within(menu).getByRole("menuitemradio", { name: /Same name.*\/synthetic\/b.*project-b/ });
  expect(a).not.toBe(b);
  expect(screen.getByRole("button", { name: "Switch project" }).title).toContain("/synthetic/a");
  expect(screen.getByRole("button", { name: "Switch project" }).title).toContain("project-a");
});
it("active-card filters keep the existing no-match guidance", async () => {
  render(<App />);
  await screen.findByText("Previous active card");
  fireEvent.change(screen.getByRole("searchbox", { name: /Search issues/ }), { target: { value: "unmatched query" } });
  expect(screen.getAllByText("No issues match the current filters").length).toBeGreaterThan(0);
  expect(screen.queryByText("This project has no issues yet")).toBeNull();
});
it("archived-only projects keep archive cards visible when archive is a main column", async () => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(projectBoardDisplaySettingsStorageEntries).mockReturnValue([[`${PROJECT_BOARD_DISPLAY_SETTINGS_KEY_PREFIX}project-a`,
    JSON.stringify({ cover: true, body: false, mainStatuses: ["todo", "archived"], sidebarStatuses: [], hiddenStatuses: ["backlog", "in_progress", "in_review", "blocked", "done", "canceled"] })]]);
  render(<App />);
  expect(await screen.findByText("Previous archived card")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
});
it("a hidden archive explains how to reveal it without offering an unusable archive action", async () => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(projectBoardDisplaySettingsStorageEntries).mockReturnValue([[`${PROJECT_BOARD_DISPLAY_SETTINGS_KEY_PREFIX}project-a`,
    JSON.stringify({ cover: true, body: false, mainStatuses: ["todo"], sidebarStatuses: [], hiddenStatuses: ["backlog", "in_progress", "in_review", "blocked", "done", "canceled", "archived"] })]]);
  render(<App />);
  await screen.findByRole("heading", { name: "No active issues in this project" });
  expect(screen.queryByRole("button", { name: "View archived issues" })).toBeNull();
  expect(screen.getByText(/display settings/)).toBeTruthy();
});
it.each(["List", "Gantt", "Dashboard"])("%s explains archived-only data even when Board has an archive main column", async (view) => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  vi.mocked(projectBoardDisplaySettingsStorageEntries).mockReturnValue([[`${PROJECT_BOARD_DISPLAY_SETTINGS_KEY_PREFIX}project-a`,
    JSON.stringify({ cover: true, body: false, mainStatuses: ["todo", "archived"], sidebarStatuses: [], hiddenStatuses: ["backlog", "in_progress", "in_review", "blocked", "done", "canceled"] })]]);
  render(<App />);
  await screen.findByText("Previous archived card");
  fireEvent.click(screen.getByRole("button", { name: view }));
  expect(await screen.findByRole("heading", { name: "No active issues in this project" })).toBeTruthy();
  expect(screen.getByText(/1 archived issue/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View archived issues" }));
  expect(await screen.findByText("Previous archived card")).toBeTruthy();
});
it.each(["List", "Gantt", "Dashboard"])("%s explains archived-only data after the Board archive sidebar was opened", async (view) => {
  vi.mocked(api.listTasks).mockResolvedValue([]);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "View archived issues" }));
  await screen.findByText("Previous archived card");
  fireEvent.click(screen.getByRole("button", { name: view }));
  expect(await screen.findByRole("heading", { name: "No active issues in this project" })).toBeTruthy();
  expect(screen.getByText(/1 archived issue/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import current project task status" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View archived issues" }));
  expect(await screen.findByText("Previous archived card")).toBeTruthy();
});
