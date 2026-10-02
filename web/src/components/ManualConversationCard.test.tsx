import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {ManualConversationCard, ManualCardAssociations} from './ManualConversationCard';
const api=vi.hoisted(()=>({createManualCard:vi.fn(),getTask:vi.fn(),listManualCardAssociations:vi.fn(),revokeManualCardAssociation:vi.fn()}));
vi.mock('../api',()=>({...api,ApiError:class extends Error {code:string;details:unknown;constructor(code:string,details:unknown){super(code);this.code=code;this.details=details;}}}));
import {ApiError} from '../api';
beforeEach(()=>vi.resetAllMocks());afterEach(cleanup);
function fill(){fireEvent.change(screen.getByLabelText('Codex 会话 ID'),{target:{value:'thread1'}});fireEvent.change(screen.getByLabelText('卡片标题'),{target:{value:'Explicit card'}});}
test('network retry reuses request identity and double submission is suppressed',async()=>{
  api.createManualCard.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce({task:{id:'task1'}});
  const onOpen=vi.fn();render(<ManualConversationCard projectId="p1" onClose={vi.fn()} onOpen={onOpen}/>);fill();
  const button=screen.getByRole('button',{name:'核验来源并创建卡片'});fireEvent.click(button);fireEvent.click(button);
  await screen.findByText('connection lost');expect(api.createManualCard).toHaveBeenCalledTimes(1);
  fireEvent.click(button);await waitFor(()=>expect(onOpen).toHaveBeenCalledTimes(1));
  expect(api.createManualCard.mock.calls[0][0].requestId).toBe(api.createManualCard.mock.calls[1][0].requestId);
  expect(api.createManualCard.mock.calls[0][0].allowAdditional).toBe(false);
});
test('duplicate response offers opening original and requires explicit action for another card',async()=>{
  const error=Object.assign(Object.create(ApiError.prototype),{message:'exists',code:'MANUAL_CARD_EXISTS',details:{taskId:'existing'}});
  api.createManualCard.mockRejectedValueOnce(error).mockResolvedValueOnce({task:{id:'new'}});
  render(<ManualConversationCard projectId="p1" onClose={vi.fn()} onOpen={vi.fn()}/>);fill();
  fireEvent.click(screen.getByRole('button',{name:'核验来源并创建卡片'}));
  const additional=await screen.findByRole('button',{name:'明确新建另一张卡片'});
  expect(screen.getByRole('button',{name:'打开已有卡片'})).toBeTruthy();expect(api.createManualCard).toHaveBeenCalledTimes(1);
  fireEvent.click(additional);await waitFor(()=>expect(api.createManualCard).toHaveBeenCalledTimes(2));
  expect(api.createManualCard.mock.calls[1][0].allowAdditional).toBe(true);
  expect(api.createManualCard.mock.calls[1][0].requestId).not.toBe(api.createManualCard.mock.calls[0][0].requestId);
});
test('association revocation needs confirmation and displays retained provenance as revoked',async()=>{
  const item={requestId:'r1',taskId:'t1',active:true,source:{threadId:'thread1',codexHostId:'local',codexProjectId:'p1',workspacePath:'/synthetic'}};
  api.listManualCardAssociations.mockResolvedValue([item]);api.revokeManualCardAssociation.mockResolvedValue({...item,active:false});
  render(<ManualCardAssociations taskId="t1"/>);
  fireEvent.click(await screen.findByRole('button',{name:'撤销此关联'}));expect(api.revokeManualCardAssociation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'确认撤销关联'}));
  expect(await screen.findByText(/关联已撤销（保留来源记录）/)).toBeTruthy();
  expect(api.revokeManualCardAssociation).toHaveBeenCalledWith('r1','t1');
});

test('late association response cannot replace the next task view',async()=>{
  let finish!: (rows: unknown[]) => void;
  api.listManualCardAssociations.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce([]);
  const view=render(<ManualCardAssociations taskId="old"/>);
  view.rerender(<ManualCardAssociations taskId="new"/>);
  finish([{requestId:'old-request',taskId:'old',active:true,source:{threadId:'OLD_THREAD',codexHostId:'local',codexProjectId:'p1',workspacePath:'/old'}}]);
  await waitFor(()=>expect(api.listManualCardAssociations).toHaveBeenCalledWith('new'));
  expect(screen.queryByText(/OLD_THREAD/)).toBeNull();
});
test('failed revocation retains the association and permits retry',async()=>{
  const item={requestId:'r1',taskId:'t1',active:true,source:{threadId:'thread1',codexHostId:'local',codexProjectId:'p1',workspacePath:'/synthetic'}};
  api.listManualCardAssociations.mockResolvedValue([item]);
  api.revokeManualCardAssociation.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({...item,active:false});
  render(<ManualCardAssociations taskId="t1"/>);
  fireEvent.click(await screen.findByRole('button',{name:'撤销此关联'}));
  fireEvent.click(screen.getByRole('button',{name:'确认撤销关联'}));
  await screen.findByText('offline');expect(screen.getByText(/关联有效/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'确认撤销关联'}));
  await screen.findByText(/关联已撤销/);expect(api.revokeManualCardAssociation).toHaveBeenCalledTimes(2);
});
