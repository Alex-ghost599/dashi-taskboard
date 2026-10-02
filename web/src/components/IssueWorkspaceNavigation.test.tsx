import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IssueWorkspaceNavigation } from './IssueWorkspaceNavigation';
import { TaskboardLanguageProvider } from '../i18n';
import { resolveIssueWorkspace } from '../issueWorkspace.mjs';
import type { Task } from '../types';
afterEach(cleanup);
function card(id: string, parent: Task | null = null, archivedAt: string | null = null): Task {
  return { id, projectId: 'p', identifier: `P-${id}`, title: id, archivedAt, relations: { parent } } as Task;
}
it('breadcrumbs navigate to the root and ancestor without replacing the parent detail action', () => {
  const root = card('root'); const parent = card('parent', root); const onNavigate = vi.fn(); const onOpenTask = vi.fn();
  render(<TaskboardLanguageProvider language="en"><IssueWorkspaceNavigation projectName="Project" workspace={resolveIssueWorkspace([root, parent], 'p', 'parent')} tasks={[]} detailTask={null} onNavigate={onNavigate} onOpenTask={onOpenTask}/></TaskboardLanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Project' })); expect(onNavigate).toHaveBeenLastCalledWith(null);
  fireEvent.click(screen.getByRole('button', { name: 'P-root · root' })); expect(onNavigate).toHaveBeenLastCalledWith('root');
  fireEvent.click(screen.getByRole('button', { name: 'Open parent issue details' })); expect(onOpenTask).toHaveBeenCalledWith(parent);
});
it('archived scope keeps navigation but omits its writable detail entrance', () => {
  const root = card('root', null, '2026-10-01'); const child = card('child', root); const onNavigate = vi.fn();
  render(<TaskboardLanguageProvider language="en"><IssueWorkspaceNavigation projectName="Project" workspace={resolveIssueWorkspace([root, child], 'p', 'root')} tasks={[child]} detailTask={null} onNavigate={onNavigate} onOpenTask={vi.fn()}/></TaskboardLanguageProvider>);
  expect(screen.queryByRole('button', { name: 'Open parent issue details' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Open issue workspace' }), { target: { value: 'child' } }); expect(onNavigate).toHaveBeenCalledWith('child');
});
