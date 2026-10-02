import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {ConversationImportPreview} from './ConversationImportPreview';
const api=vi.hoisted(()=>({previewProjectConversations:vi.fn(),prepareConversationImport:vi.fn(),saveConversationImport:vi.fn(),discardConversationImport:vi.fn()}));
vi.mock('../api',()=>api);
afterEach(cleanup);
beforeEach(()=>{vi.resetAllMocks();api.discardConversationImport.mockResolvedValue({discarded:true});});
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

test('selected source prepares editable user text and saves only after an explicit review action',async()=>{
  const source={scope:'sessions',path:'one.jsonl',headerSha256:'fingerprint',timestamp:null};
  api.previewProjectConversations.mockResolvedValue({complete:true,excludedFiles:0,conflictingThreadIds:[],candidates:[{threadId:'source-id',existingTaskIds:[],sourceFiles:[source]}]});
  api.prepareConversationImport.mockResolvedValue({proposalId:'proposal',title:'Source proposal',description:'Original user requirement',canSave:true,coverage:{complete:true},status:'unknown',authorizesDispatch:false});
  api.saveConversationImport.mockResolvedValue({task:{id:'card',identifier:'SYN-1',status:'backlog'},alreadyImported:false});
  const saved=vi.fn();render(<ConversationImportPreview projectId="p1" onSaved={saved}/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  fireEvent.click(await screen.findByRole('button',{name:'读取此来源并准备卡片'}));
  const title=await screen.findByLabelText('卡片标题');
  expect(api.prepareConversationImport.mock.calls[0][0]).toEqual({projectId:'p1',threadId:'source-id',sourceFile:source});
  expect(api.saveConversationImport).not.toHaveBeenCalled();
  fireEvent.change(title,{target:{value:'Reviewed title'}});
  fireEvent.click(screen.getByRole('button',{name:'保存为 Backlog 卡片'}));
  expect(await screen.findByText(/SYN-1/)).toBeTruthy();
  expect(api.saveConversationImport.mock.calls[0][0]).toEqual({proposalId:'proposal',title:'Reviewed title',description:'Original user requirement'});
  expect(saved).toHaveBeenCalledTimes(1);
});

test('partial proposal explains coverage and does not permit saving a card',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:true,excludedFiles:0,conflictingThreadIds:[],candidates:[{threadId:'source-id',existingTaskIds:[],sourceFiles:[{scope:'sessions',path:'one.jsonl',headerSha256:'fingerprint'}]}]});
  api.prepareConversationImport.mockResolvedValue({proposalId:'partial',title:'Partial',description:'Limited user text',canSave:false,coverage:{complete:false},status:'unknown',authorizesDispatch:false});
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  fireEvent.click(await screen.findByRole('button',{name:'读取此来源并准备卡片'}));
  expect(await screen.findByText(/提取覆盖不足/)).toBeTruthy();
  expect(screen.getByRole('button',{name:'保存为 Backlog 卡片'})).toHaveProperty('disabled',true);
  expect(api.saveConversationImport).not.toHaveBeenCalled();
});

test('closing a pending source read discards its late proposal without saving',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:true,excludedFiles:0,conflictingThreadIds:[],candidates:[{threadId:'source-id',existingTaskIds:[],sourceFiles:[{scope:'sessions',path:'one.jsonl',headerSha256:'fingerprint'}]}]});
  let resolve!: (value:unknown)=>void;
  api.prepareConversationImport.mockReturnValue(new Promise(done=>{resolve=done;}));
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  fireEvent.click(await screen.findByRole('button',{name:'读取此来源并准备卡片'}));
  fireEvent.click(screen.getByRole('button',{name:'关闭预览'}));
  resolve({proposalId:'late',title:'Late',description:'Late user text',canSave:true,coverage:{complete:true}});
  await vi.waitFor(()=>expect(api.discardConversationImport).toHaveBeenCalledWith('late'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.saveConversationImport).not.toHaveBeenCalled();
});

test('a lost save receipt keeps the reviewed proposal available for idempotent retry',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:true,excludedFiles:0,conflictingThreadIds:[],candidates:[{threadId:'source-id',existingTaskIds:[],sourceFiles:[{scope:'sessions',path:'one.jsonl',headerSha256:'fingerprint'}]}]});
  api.prepareConversationImport.mockResolvedValue({proposalId:'retry',title:'Reviewed',description:'User text',canSave:true,coverage:{complete:true},status:'unknown'});
  api.saveConversationImport.mockRejectedValueOnce(new Error('Receipt unavailable'))
    .mockResolvedValueOnce({task:{id:'card',identifier:'SYN-2'},alreadyImported:false,replayed:true});
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  fireEvent.click(await screen.findByRole('button',{name:'读取此来源并准备卡片'}));
  fireEvent.click(await screen.findByRole('button',{name:'保存为 Backlog 卡片'}));
  expect(await screen.findByText('Receipt unavailable')).toBeTruthy();
  expect(screen.getByLabelText('卡片标题')).toHaveProperty('value','Reviewed');
  fireEvent.click(screen.getByRole('button',{name:'保存为 Backlog 卡片'}));
  expect(await screen.findByText(/SYN-2/)).toBeTruthy();
  expect(api.saveConversationImport.mock.calls[0][0]).toEqual(api.saveConversationImport.mock.calls[1][0]);
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

test('archive source selection needs another explicit preview and unavailable roots stay visible',async()=>{
  api.previewProjectConversations.mockResolvedValue({complete:true,excludedFiles:0,conflictingThreadIds:[],candidates:[]});
  render(<ConversationImportPreview projectId="p1"/>);
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  await screen.findByText('没有匹配的会话来源');
  expect(api.previewProjectConversations).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(api.previewProjectConversations).toHaveBeenCalledTimes(1);
  api.previewProjectConversations.mockResolvedValue({complete:false,excludedFiles:0,conflictingThreadIds:[],unavailableSources:[{scope:'archived_sessions',code:'SOURCE_UNAVAILABLE'}],candidates:[]});
  fireEvent.click(screen.getByRole('button',{name:'预览本项目会话来源'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent',expect.stringContaining('1 个来源根不可用'));
  expect(api.previewProjectConversations.mock.calls[1][1].includeArchived).toBe(true);
  expect(screen.queryByText('没有匹配的会话来源')).toBeNull();
});
