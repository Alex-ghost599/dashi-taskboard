import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../App';
import type { Task, Project } from '../types';
import { taskboardStorage } from '../storage';
import { createTask, addTaskRelation } from '../api';

const fixture = vi.hoisted(() => ({ localAiChat: false, active: [] as Task[], archived: [] as Task[], ganttData: [] as Array<{ id: string; text: string; taskboardGroup: boolean }> }));
vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  listProjects: vi.fn(async () => ['p', 'q'].map(id => ({ id, name: `Project ${id}`, source: 'local', workspacePath: null, labels: [], issueCount: 3, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' } as Project))),
  listTasks: vi.fn(async (projectId?: string) => fixture.active.filter(t => !projectId || t.projectId === projectId)),
  listArchivedTasks: vi.fn(async (projectId?: string) => fixture.archived.filter(t => !projectId || t.projectId === projectId)),
  createTask: vi.fn(), addTaskRelation: vi.fn(),
  getTaskboardMetadata: vi.fn(async () => ({ mode: 'cloud', capabilities: { localAiChat: fixture.localAiChat } })),
  getAiChatCatalog: vi.fn(async () => ({ models: [] })),
  listDeviceWorkspaces: vi.fn(async () => ({})),
  getJiraConnection: vi.fn(async () => ({ configured: false })),
  listDevelopmentContexts: vi.fn(async () => ({ workspacePath: null, contexts: [] })),
  listComments: vi.fn(async () => []), listAttachments: vi.fn(async () => []), listTaskActivities: vi.fn(async () => []),
  getTask: vi.fn(async (id: string) => [...fixture.active, ...fixture.archived].find(t => t.id === id)),
  getProjectSummary: vi.fn(async (projectId: string) => ({ projectId, summary: null, refreshing: false, updatedAt: null, error: null })),
}));
vi.mock('./AiChat', () => ({ AiChat: () => <button>Synthetic AI execution entry</button> }));
// The browser-only Gantt engine is a synthetic sink; App and GanttView stay real.
vi.mock('dhtmlx-gantt', () => ({ Gantt: { getGanttInstance: () => new Proxy({
  config: {}, templates: {}, ext: { zoom: { init() {}, setLevel() {} } },
  getScrollState: () => ({ x: 0, y: 0 }), isTaskExists: () => false, posFromDate: () => 0,
  parse: (payload: { data: typeof fixture.ganttData }) => { fixture.ganttData = payload.data; },
}, { get(target, key) { return Reflect.get(target, key) ?? (() => {}); } }) } }));
function task(id: string, parent: Task | null = null, projectId = 'p'): Task {
  return { id, identifier: `P-${id}`, projectId, title: `Card ${id}`, description: '', status: 'todo', priority: 'none', labels: [], sortOrder: 1024,
    threadId: null, threadBinding: null, legacyLocalThreadId: null, conversationRefs: [], participants: [], previewImage: null,
    creatorType: 'user', creatorId: 'u', creatorName: 'User', creatorAvatarUrl: null, activityKey: id, activityUpdatedAt: '2026-10-01T00:00:00Z', assignee: { type: 'user', id: 'u', name: 'User', avatarUrl: null },
    developmentContext: null, startDate: null, dueDate: null, recurrence: null, source: 'local', externalUrl: null, archivedAt: null,
    relations: { parent, subIssues: [], related: [], blockedBy: [], blocks: [] }, version: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  } as Task;
}
beforeEach(() => {
  const entries = new Map([['taskboard.first-use-complete.v1', 'true'], ['taskboard.project-view.v1.p', 'list']]);
  vi.spyOn(taskboardStorage, 'getItem').mockImplementation(key => entries.get(key) ?? null);
  vi.spyOn(taskboardStorage, 'setItem').mockImplementation((key, value) => { entries.set(key, value); });
  window.history.replaceState(null, '', '/?project=p&lang=en');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = task('1'); const child = task('2', root); const grandchild = task('3', child);
  fixture.localAiChat = false;
  fixture.active = [root, child, grandchild, task('4', null, 'q')]; fixture.archived = []; fixture.ganttData = [];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function list() { return within(await screen.findByRole('button', { name: /Card 1/ })).getByText('Card 1'); }
it('project root projects only root cards while All projects remains flat', async () => {
  render(<App />); await list();
  expect(document.querySelector('.issue-list-view')?.textContent).not.toContain('Card 2');
  fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /All projects/ }));
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 3'));
});
it('nested URL shows direct children and details return to the same scope', async () => {
  window.history.replaceState(null, '', '/?project=p&parent=1&lang=en'); render(<App />);
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  expect(document.querySelector('.issue-list-view')?.textContent).not.toContain('Card 1');
  expect(document.querySelector('.issue-list-view')?.textContent).not.toContain('Card 3');
  fireEvent.click(screen.getByRole('button', { name: /P-2Card 2/ }));
  await waitFor(() => expect(new URL(window.location.href).searchParams.get('issue')).toBe('P-2'));
  expect(new URL(window.location.href).searchParams.get('parent')).toBe('1');
  fireEvent.click(screen.getByRole('button', { name: 'Back to issue board' }));
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  expect(new URL(window.location.href).searchParams.get('parent')).toBe('1');
});
it('unknown parent scope is empty and unavailable instead of showing root cards', async () => {
  window.history.replaceState(null, '', '/?project=p&parent=missing&lang=en'); render(<App />);
  await screen.findByText(/Workspace unavailable/);
  expect(document.querySelector('.issue-list-view')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create issue' })).toBeNull();
});
it('an archived ancestor makes nested children static and blocks create shortcuts and detail writes', async () => {
  const archivedRoot = { ...fixture.active[0], archivedAt: '2026-10-02T00:00:00Z' };
  fixture.archived = [archivedRoot]; fixture.active = fixture.active.filter(t => t.id !== '1');
  window.history.replaceState(null, '', '/?project=p&parent=2&issue=P-3&lang=en'); render(<App />);
  await screen.findByText(/Archived ancestor/);
  expect(screen.queryByRole('button', { name: 'Create issue' })).toBeNull();
  expect(document.querySelector('.issue-detail')).toBeNull();
  expect(document.querySelector('[draggable="true"]')).toBeNull();
  fireEvent.keyDown(document.body, { key: 'c' });
  expect(screen.queryByPlaceholderText('Issue title')).toBeNull();
  expect(screen.getByText('Card 3', { selector: '.issue-workspace-static-list strong' })).toBeTruthy();
});
it('popstate changes parent scope and project switch removes it', async () => {
  render(<App />); await list();
  window.history.pushState(null, '', '/?project=p&parent=2&lang=en'); fireEvent.popState(window);
  await screen.findByText('Card 3', { selector: '.issue-list-title-cell strong' });
  expect(document.querySelector('.issue-list-view')?.textContent).not.toContain('Card 2');
  fireEvent.click(screen.getByRole('button', { name: 'Switch project' }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Project q/ }));
  await waitFor(() => expect(new URL(window.location.href).searchParams.get('project')).toBe('q'));
  expect(new URL(window.location.href).searchParams.get('parent')).toBeNull();
});
it('root and nested board/dashboard use the same level, and dashboard keeps its existing search semantics', async () => {
  render(<App />); await list();
  fireEvent.click(screen.getByRole('button', { name: 'Issue board' }));
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 1'));
  expect(document.querySelector('.board')?.textContent).not.toContain('Card 2');
  fireEvent.change(screen.getByRole('combobox', { name: 'Open issue workspace' }), { target: { value: '1' } });
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 2'));
  expect(document.querySelector('.board')?.textContent).not.toContain('Card 3');
  fireEvent.change(screen.getByRole('searchbox', { name: /Search/ }), { target: { value: 'no match' } });
  expect(document.querySelector('.board')?.textContent).not.toContain('Card 2');
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
  await screen.findByText('0 completed · 1 remaining');
  fireEvent.click(screen.getByRole('button', { name: 'Project p' }));
  await screen.findByText('0 completed · 1 remaining');
});
it('cancelled drafts remain separated by parent scope and return with the selected parent', async () => {
  render(<App />); await list();
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'Root draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Open issue workspace' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  expect((screen.getByPlaceholderText('Issue title') as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'Nested draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  fireEvent.click(screen.getByRole('button', { name: 'Project p' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  expect((screen.getByPlaceholderText('Issue title') as HTMLTextAreaElement).value).toBe('Root draft');
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Open issue workspace' }), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  expect((screen.getByPlaceholderText('Issue title') as HTMLTextAreaElement).value).toBe('Nested draft');
  expect(screen.getByRole('dialog').textContent).toContain('Card 1');
});
it('the Gantt view receives only direct children', async () => {
  window.history.replaceState(null, '', '/?project=p&parent=1&lang=en'); render(<App />);
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Gantt' }));
  await waitFor(() => expect(fixture.ganttData.filter(t => !t.taskboardGroup).map(t => t.id)).toEqual(['2']));
});
it('All projects can enter the chosen task workspace in its owning project', async () => {
  window.history.replaceState(null, '', '/?project=__all_projects__&lang=en'); render(<App />);
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 3'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Open issue workspace' }), { target: { value: '1' } });
  await waitFor(() => expect(new URL(window.location.href).searchParams.get('project')).toBe('p'));
  expect(new URL(window.location.href).searchParams.get('parent')).toBe('1');
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
});
it('browser scope navigation preserves an open unsaved draft', async () => {
  render(<App />); await list();
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'In-flight draft' } });
  window.history.pushState(null, '', '/?project=p&parent=1&lang=en'); fireEvent.popState(window);
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Project p' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  expect((screen.getByPlaceholderText('Issue title') as HTMLTextAreaElement).value).toBe('In-flight draft');
});
it('nested create links the new card to its parent and leaves it out of the project root', async () => {
  vi.mocked(createTask).mockImplementation(async (projectId, draft) => ({ ...task('5', null, projectId), ...draft }));
  vi.mocked(addTaskRelation).mockImplementation(async (created, _type, parentId) => ({
    task: { ...created, relations: { ...created.relations, parent: fixture.active.find(t => t.id === parentId)! } },
    relatedTask: fixture.active.find(t => t.id === parentId)!,
  }));
  window.history.replaceState(null, '', '/?project=p&parent=1&lang=en'); render(<App />);
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'Created child' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create issue' }));
  await screen.findByText('Created child', { selector: '.issue-list-title-cell strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Project p' }));
  await list();
  expect(document.querySelector('.issue-list-view')?.textContent).not.toContain('Created child');
});
it('failed parent linking reports the already-created card and makes it available at the root', async () => {
  vi.mocked(createTask).mockImplementation(async (projectId, draft) => ({ ...task('5', null, projectId), ...draft }));
  vi.mocked(addTaskRelation).mockRejectedValue(new Error('parent relation failed'));
  window.history.replaceState(null, '', '/?project=p&parent=1&lang=en'); render(<App />);
  await screen.findByText('Card 2', { selector: '.issue-list-title-cell strong' });
  fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));
  fireEvent.change(screen.getByPlaceholderText('Issue title'), { target: { value: 'Created but unlinked' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create issue' }));
  await screen.findByText(/P-5 was created, but.*parent relation/);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Project p' }));
  await screen.findByText('Created but unlinked', { selector: '.issue-list-title-cell strong' });
});
it('All projects task details return to the original flat project scope', async () => {
  window.history.replaceState(null, '', '/?project=__all_projects__&lang=en'); render(<App />);
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 3'));
  fireEvent.click(screen.getByRole('button', { name: /P-2.*Card 2/ }));
  await screen.findByRole('button', { name: 'Back to issue board' });
  expect(new URL(window.location.href).searchParams.get('project')).toBe('p');
  fireEvent.click(screen.getByRole('button', { name: 'Back to issue board' }));
  await waitFor(() => expect(document.querySelector('.board')?.textContent).toContain('Card 3'));
  expect(new URL(window.location.href).searchParams.get('project')).toBe('__all_projects__');
});

it('removes the available AI execution surface in an archived ancestor workspace', async () => {
  fixture.localAiChat = true;
  fixture.archived = [{ ...fixture.active[0], archivedAt: '2026-10-02T00:00:00Z' }];
  fixture.active = fixture.active.filter(t => t.id !== '1');
  render(<App />);
  await screen.findByRole('button', { name: 'Synthetic AI execution entry' });
  window.history.pushState(null, '', '/?project=p&parent=2&lang=en');
  fireEvent.popState(window);
  await screen.findByText(/Archived ancestor/);
  expect(screen.queryByRole('button', { name: 'Synthetic AI execution entry' })).toBeNull();
});
