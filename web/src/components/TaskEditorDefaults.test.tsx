import { expect, it, vi, afterEach } from 'vitest';
import { readTaskEditorDefaults, saveTaskEditorDefaults, currentDevelopmentContext } from '../taskEditorDefaults';
import { taskboardStorage } from '../storage';

afterEach(() => vi.restoreAllMocks());
it('preferences are scoped and only persist priority and labels', () => {
  saveTaskEditorDefaults('project-a','user-a','high',['one','removed']);
  expect(readTaskEditorDefaults('project-a','user-a',['one'])).toEqual({priority:'high',labels:['one']});
  expect(readTaskEditorDefaults('project-b','user-a',['one']).priority).toBe('none');
  expect(readTaskEditorDefaults('project-a','user-b',['one']).priority).toBe('none');
  expect(readTaskEditorDefaults(null,'user-a',['one']).labels).toEqual([]);
});
it('corrupt storage and storage write failures do not fail task entry', () => {
  vi.spyOn(taskboardStorage,'getItem').mockReturnValue('{bad');
  expect(readTaskEditorDefaults('project-a','user-a',[]).priority).toBe('none');
  vi.spyOn(taskboardStorage,'setItem').mockImplementation(()=>{throw new Error('quota');});
  expect(()=>saveTaskEditorDefaults('project-a','user-a','low',[])).not.toThrow();
});
it('current branch requires an exact unique current worktree and a real local branch', () => {
  const branch={type:'branch' as const,branch:'develop'};
  const worktree={type:'worktree' as const,branch:'develop',path:'/project'};
  expect(currentDevelopmentContext({workspacePath:'/project',contexts:[branch,worktree]})).toEqual(branch);
  expect(currentDevelopmentContext({workspacePath:'/other',contexts:[branch,worktree]})).toBeNull();
  expect(currentDevelopmentContext({workspacePath:'/project',contexts:[branch,worktree,worktree]})).toBeNull();
  expect(currentDevelopmentContext({workspacePath:'/project',contexts:[{...worktree,branch:null}]})).toBeNull();
});

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TaskEditor, type NewTaskEditorDraft } from './TaskEditor';
import type { ActorIdentity, TaskDraft } from '../types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype,'close'); });
const currentUser: ActorIdentity = {type:'user',id:'form-test',name:'Test',avatarUrl:null};
function editorProps() {
  return {projectId:'form-project',task:null,tasks:[],referenceTasks:[],initialStatus:'backlog' as const,initialDraft:null,
    labels:['one'],currentUser,developmentScan:{workspacePath:null,contexts:[]},developmentScanLoading:false,
    onCreateLabel:vi.fn(async()=>{}),onCancel:vi.fn(),onSave:vi.fn(async(_draft: TaskDraft)=>{})};
}
it('opening and editing defaults creates nothing; an explicit save remembers only common properties',async()=>{
  HTMLDialogElement.prototype.showModal=vi.fn(function(this: HTMLDialogElement){ this.open=true; });
  HTMLDialogElement.prototype.close=vi.fn(function(this: HTMLDialogElement){ this.open=false; });
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const props=editorProps();
  saveTaskEditorDefaults(props.projectId,'user:form-test','high',['one']);
  const view=render(<TaskEditor {...props}/>);
  expect(props.onSave).not.toHaveBeenCalled();
  expect((screen.getByLabelText(/Start date|开始日期/) as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'explicit test card'}});
  expect(props.onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  const draft=props.onSave.mock.calls[0]?.[0] as unknown as Record<string,unknown>;
  expect(draft.status).toBe('backlog');
  expect(draft).not.toHaveProperty('threadBinding');
  expect(draft).not.toHaveProperty('authorization');
  view.unmount();
  vi.unstubAllGlobals();
});

function prepareDialog() {
  HTMLDialogElement.prototype.showModal=vi.fn(function(this: HTMLDialogElement){this.open=true;});
  HTMLDialogElement.prototype.close=vi.fn(function(this: HTMLDialogElement){this.open=false;});
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
}
it('a project switch cannot carry the old scanned branch into a new empty project',()=>{
  prepareDialog();const props=editorProps();
  const scan={workspacePath:'/a',contexts:[{type:'branch' as const,branch:'old-branch'},{type:'worktree' as const,path:'/a',branch:'old-branch'}]};
  const view=render(<TaskEditor {...props} developmentScanProjectId={props.projectId} developmentScan={scan}/>);
  expect(screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/}).textContent).toContain('old-branch');
  view.rerender(<TaskEditor {...props} projectId="new-project" developmentScanProjectId={props.projectId} developmentScan={scan}/>);
  expect(screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/}).textContent).not.toContain('old-branch');
  view.rerender(<TaskEditor {...props} projectId="new-project" developmentScanProjectId="new-project" developmentScanLoading={true}/>);
  view.rerender(<TaskEditor {...props} projectId="new-project" developmentScanProjectId="new-project"/>);
  expect(screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/}).textContent).not.toContain('old-branch');
});
it('an account change blocks saving the previous account form',()=>{
  prepareDialog();const props=editorProps();const view=render(<TaskEditor {...props}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'account boundary'}});
  view.rerender(<TaskEditor {...props} currentUser={{...currentUser,id:'other'}}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  expect(props.onSave).not.toHaveBeenCalled();
  expect(screen.getByText(/Account changed|账户已变化/)).toBeTruthy();
});
it('a failed create does not write preference storage',async()=>{
  prepareDialog();const props=editorProps();props.onSave.mockRejectedValue(new Error('save failed'));
  const storage=vi.spyOn(taskboardStorage,'setItem');render(<TaskEditor {...props}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'failure boundary'}});
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await screen.findByText('save failed');
  expect(storage).not.toHaveBeenCalled();
});
it('restored drafts keep empty dates and their chosen branch instead of defaults',async()=>{
  prepareDialog();const props=editorProps();
  const draft={title:'restored draft',descriptionSegments:[],status:'todo' as const,priority:'urgent' as const,assignee:currentUser,
    selectedLabels:['one'],developmentContext:{type:'branch' as const,branch:'chosen'},startDate:'',dueDate:'',recurrence:null,
    relations:{parentId:null,relatedIds:[],subIssueIds:[]}};
  render(<TaskEditor {...props} initialDraft={draft} developmentScanProjectId={props.projectId}
    developmentScan={{workspacePath:'/a',contexts:[{type:'branch',branch:'other'},{type:'worktree',path:'/a',branch:'other'}]}}/>);
  expect((screen.getByLabelText(/Start date|开始日期/) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/Due date|截止日期/) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0][0]).toMatchObject({priority:'urgent',developmentContext:{type:'branch',branch:'chosen'},startDate:null,dueDate:null,status:'backlog'});
});
it('a manual branch choice survives later scan refreshes',()=>{
  prepareDialog();const props=editorProps();
  const scan={workspacePath:'/a',contexts:[{type:'branch' as const,branch:'auto'},{type:'branch' as const,branch:'manual'},{type:'worktree' as const,path:'/a',branch:'auto'}]};
  const view=render(<TaskEditor {...props} developmentScanProjectId={props.projectId} developmentScan={scan}/>);
  fireEvent.click(screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/}));
  fireEvent.click(screen.getByRole('option',{name:'manual'}));
  view.rerender(<TaskEditor {...props} developmentScanProjectId={props.projectId} developmentScan={{...scan}}/>);
  expect(screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/}).textContent).toContain('manual');
});
it('editing an existing card preserves empty dates and does not overwrite create preferences',async()=>{
  prepareDialog();const props=editorProps();
  const task={id:'existing',title:'existing card',description:'',status:'todo',priority:'low',assignee:currentUser,
    labels:['one'],developmentContext:null,startDate:null,dueDate:null,recurrence:null} as import('../types').Task;
  const storage=vi.spyOn(taskboardStorage,'setItem');render(<TaskEditor {...props} task={task}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  expect((screen.getByLabelText(/Start date|开始日期/) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(/Due date|截止日期/) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button',{name:/Save changes|保存更改/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(storage).not.toHaveBeenCalled();
  expect(props.onSave.mock.calls[0][0].developmentContext).toBeNull();
});

it('nested creation initializes its parent relation',async()=>{
  prepareDialog(); const props=editorProps();
  const onSave=vi.fn(async(_draft: TaskDraft, _files: unknown[], _images: unknown[], _options?: import('./TaskEditor').NewTaskCreateOptions)=>{});
  render(<TaskEditor {...props} defaultParentId="workspace-parent" onSave={onSave}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'nested card'}});
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[3]).toMatchObject({relations:{parentId:'workspace-parent'}});
});
it('a restored explicit no-parent choice overrides the workspace default',async()=>{
  prepareDialog(); const props=editorProps();
  const onSave=vi.fn(async(_draft: TaskDraft, _files: unknown[], _images: unknown[], _options?: import('./TaskEditor').NewTaskCreateOptions)=>{});
  const draft={title:'no parent',descriptionSegments:[],status:'todo' as const,priority:'none' as const,assignee:currentUser,selectedLabels:[],developmentContext:null,startDate:'',dueDate:'',recurrence:null,relations:{parentId:null,relatedIds:[],subIssueIds:[]}};
  render(<TaskEditor {...props} defaultParentId="workspace-parent" initialDraft={draft} onSave={onSave}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[3]?.relations.parentId).toBeNull();
});
it('switching the create target project clears the old parent relation',async()=>{
  prepareDialog(); const props=editorProps();
  const onSave=vi.fn(async(_draft: TaskDraft, _files: unknown[], _images: unknown[], _options?: import('./TaskEditor').NewTaskCreateOptions)=>{});
  const view=render(<TaskEditor {...props} defaultParentId="old-project-parent" onSave={onSave}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'switched target'}});
  view.rerender(<TaskEditor {...props} projectId="new-project" defaultParentId={null} onSave={onSave}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0]?.[3]?.relations.parentId).toBeNull();
});

const mainScan={workspacePath:'/synthetic/editor-project',contexts:[
  {type:'branch' as const,branch:'main'},
  {type:'branch' as const,branch:'manual'},
  {type:'worktree' as const,path:'/synthetic/editor-project',branch:'main'},
]};
function developmentPicker() {
  return screen.getByRole('button',{name:/Code branch or worktree|代码分支或 Worktree/});
}
it('an untouched draft closed while scanning uses the matching branch after reopening',async()=>{
  prepareDialog();const props=editorProps();const onDraftChange=vi.fn();
  const view=render(<TaskEditor {...props} onDraftChange={onDraftChange}
    developmentScanProjectId={props.projectId} developmentScanLoading={true}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'waiting draft'}});
  fireEvent.click(screen.getByRole('button',{name:/Close editor|关闭/}));
  const retained=props.onCancel.mock.calls[0][0] as NewTaskEditorDraft;
  expect(retained.developmentContext).toBeNull();
  view.unmount();
  render(<TaskEditor {...props} initialDraft={retained} onDraftChange={onDraftChange}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  expect(developmentPicker().textContent).toContain('main');
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0][0]).toMatchObject({title:'waiting draft',developmentContext:{type:'branch',branch:'main'}});
});
it('clearing the branch persists through live draft restoration, cancellation and rescans',async()=>{
  prepareDialog();const props=editorProps();const onDraftChange=vi.fn();
  const view=render(<TaskEditor {...props} onDraftChange={onDraftChange}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'explicit clear'}});
  expect(developmentPicker().textContent).toContain('main');
  fireEvent.click(developmentPicker());
  fireEvent.click(screen.getByRole('option',{name:/^Branch \/ worktree$|^分支 \/ Worktree$/}));
  const retained=onDraftChange.mock.calls.at(-1)?.[0] as NewTaskEditorDraft;
  expect(retained.developmentContext).toBeNull();
  view.unmount();
  const reopened=render(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  reopened.rerender(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScanLoading={true}/>);
  reopened.rerender(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScan={{...mainScan}}/>);
  fireEvent.click(screen.getByRole('button',{name:/Close editor|关闭/}));
  const cancelled=props.onCancel.mock.calls[0][0] as NewTaskEditorDraft;
  reopened.unmount();
  render(<TaskEditor {...props} initialDraft={cancelled}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0][0].developmentContext).toBeNull();
});
it('a manual branch survives draft cancellation, reopening and later matching scans',async()=>{
  prepareDialog();const props=editorProps();
  const view=render(<TaskEditor {...props} developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'manual draft'}});
  fireEvent.click(developmentPicker());fireEvent.click(screen.getByRole('option',{name:'manual'}));
  fireEvent.click(screen.getByRole('button',{name:/Close editor|关闭/}));
  const retained=props.onCancel.mock.calls[0][0] as NewTaskEditorDraft;
  view.unmount();
  const reopened=render(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  reopened.rerender(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScan={{...mainScan}}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0][0].developmentContext).toEqual({type:'branch',branch:'manual'});
});
it('a legacy null draft can acquire a default while legacy non-null drafts keep their branch',()=>{
  prepareDialog();const props=editorProps();
  const draft:NewTaskEditorDraft={title:'legacy null',descriptionSegments:[],status:'todo',priority:'none',assignee:currentUser,
    selectedLabels:[],developmentContext:null,startDate:'',dueDate:'',recurrence:null,relations:{parentId:null,relatedIds:[],subIssueIds:[]}};
  const view=render(<TaskEditor {...props} initialDraft={draft}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  expect(developmentPicker().textContent).toContain('main');
  view.unmount();
  render(<TaskEditor {...props} initialDraft={{...draft,developmentContext:{type:'branch',branch:'legacy-choice'}}}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  expect(developmentPicker().textContent).toContain('legacy-choice');
});
it('explicitly choosing empty from an already null context survives immediate draft navigation and a later scan',async()=>{
  prepareDialog();const props=editorProps();const onDraftChange=vi.fn();
  const view=render(<TaskEditor {...props} onDraftChange={onDraftChange}
    developmentScanProjectId={props.projectId}/>);
  fireEvent.change(screen.getByPlaceholderText(/Issue title|议题标题/),{target:{value:'keep empty'}});
  expect(onDraftChange.mock.calls.at(-1)?.[0].developmentContext).toBeNull();
  fireEvent.click(developmentPicker());
  fireEvent.click(screen.getByRole('option',{name:/^Branch \/ worktree$|^分支 \/ Worktree$/}));
  const retained=onDraftChange.mock.calls.at(-1)?.[0] as NewTaskEditorDraft;
  view.unmount();
  expect(props.onCancel).not.toHaveBeenCalled();
  render(<TaskEditor {...props} initialDraft={retained}
    developmentScanProjectId={props.projectId} developmentScan={mainScan}/>);
  fireEvent.click(screen.getByRole('button',{name:/Create issue|创建议题/}));
  await waitFor(()=>expect(props.onSave).toHaveBeenCalledTimes(1));
  expect(props.onSave.mock.calls[0][0].developmentContext).toBeNull();
  expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('developmentContextTouched');
});
