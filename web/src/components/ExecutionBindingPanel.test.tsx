import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ExecutionBindingPanel } from './ExecutionBindingPanel';
import type { Task } from '../types';
const api = vi.hoisted(() => ({ getExecutionBinding: vi.fn(), previewExecutionBinding: vi.fn(), confirmExecutionBinding: vi.fn(), unbindExecutionBinding: vi.fn() }));
vi.mock('../api', () => api);
const task = { id: 'task1', version: 1 } as Task;
const target = { threadId: 'thread1', codexProjectId: 'project1', codexProjectKind: 'local', codexHostId: 'local', workspacePath: '/synthetic/project' };
beforeEach(() => {
  vi.resetAllMocks();
  api.getExecutionBinding.mockResolvedValue({ revision: 0, binding: null, taskVersion: 1 });
  api.previewExecutionBinding.mockResolvedValue({ previewId: 'preview1', target, expiresAt: Date.now() + 30000 });
  api.confirmExecutionBinding.mockResolvedValue({ revision: 1, binding: target });
});
afterEach(cleanup);
test('target preview requires a separate confirmation before binding', async () => {
  render(<ExecutionBindingPanel task={task} />);
  await screen.findByText('尚未绑定执行会话');
  fireEvent.change(screen.getByLabelText('已有 Codex 会话 ID'), { target: { value: 'thread1' } });
  fireEvent.click(screen.getByRole('button', { name: '核验目标' }));
  const confirm = await screen.findByRole('button', { name: '确认绑定到以上目标' });
  expect(screen.getByText('/synthetic/project')).toBeTruthy();
  expect(api.confirmExecutionBinding).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.confirmExecutionBinding).toHaveBeenCalledWith('task1', 'preview1'));
  expect(api.unbindExecutionBinding).not.toHaveBeenCalled();
});
test('desktop failure displays an error without allowing confirmation', async () => {
  api.previewExecutionBinding.mockRejectedValue(new Error('DESKTOP_UNAVAILABLE'));
  render(<ExecutionBindingPanel task={task} />);
  await screen.findByText('尚未绑定执行会话');
  fireEvent.change(screen.getByLabelText('已有 Codex 会话 ID'), { target: { value: 'thread1' } });
  fireEvent.click(screen.getByRole('button', { name: '核验目标' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'DESKTOP_UNAVAILABLE');
  expect(screen.queryByRole('button', { name: '确认绑定到以上目标' })).toBeNull();
  expect(api.confirmExecutionBinding).not.toHaveBeenCalled();
});
