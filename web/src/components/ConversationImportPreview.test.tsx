import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {ConversationImportPreview} from './ConversationImportPreview';
const api=vi.hoisted(()=>({previewProjectConversations:vi.fn()}));
vi.mock('../api',()=>api);
afterEach(cleanup);
beforeEach(()=>vi.resetAllMocks());
test('explicit preview shows unknown state and source evidence without offering execution or saving',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:true,truncated:false,excludedFiles:0,conflictingThreadIds:[],saved:false,authorizesDispatch:false,candidates:[{threadId:'source-id',status:null,existingTaskIds:['existing-card'],sourceFiles:[{path:'2026/10/02/rollout.jsonl',headerSha256:'fingerprint'}]}]});
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  expect(await screen.findByText('source-id')).toBeTruthy();
  expect(screen.getByText('状态未知，需人工整理')).toBeTruthy();
  expect(screen.getByText(/existing-card/)).toBeTruthy();
  expect(screen.getByText('2026/10/02/rollout.jsonl')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/保存|执行/})).toBeNull();
});
test('incomplete discovery is visible and request errors do not claim no sessions',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:false,truncated:true,excludedFiles:1,conflictingThreadIds:[],candidates:[]});
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('覆盖不完整'));
  api.previewProjectConversations.mockRejectedValue(new Error('SOURCE_UNAVAILABLE'));
  fireEvent.click(screen.getByRole('button',{name:'重新预览'}));
  expect(await screen.findByText('SOURCE_UNAVAILABLE')).toBeTruthy();
  expect(screen.queryByText('没有匹配的会话来源')).toBeNull();
});

test('closing a pending preview keeps a late response out of the visible project',async()=>{
  let resolve!: (value: unknown) => void;
  api.previewProjectConversations.mockReturnValue(new Promise(done=>{resolve=done;}));
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
  resolve({complete:true,truncated:false,excludedFiles:0,conflictingThreadIds:[],candidates:[{threadId:'late-source',existingTaskIds:[],sourceFiles:[]}]});
  await Promise.resolve();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('late-source')).toBeNull();
  expect(screen.getByRole('button',{name:'预览本项目会话来源'})).toBeTruthy();
});
