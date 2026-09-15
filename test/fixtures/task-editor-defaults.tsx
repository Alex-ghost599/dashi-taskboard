import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {TaskEditor} from '../../web/src/components/TaskEditor';
import {initializeTaskboardStorage} from '../../web/src/storage';
import type {TaskDraft} from '../../web/src/types';
import '../../web/src/styles.css';

function Fixture() {
  const [open,setOpen]=useState(true);
  const [saved,setSaved]=useState<TaskDraft|null>(null);
  return <><button onClick={()=>setOpen(true)}>Open new test form</button><pre>{JSON.stringify(saved,null,2)}</pre>{open&&<TaskEditor
    projectId="fixture-only" task={null} tasks={[]} referenceTasks={[]} initialStatus="backlog" initialDraft={null}
    labels={['Test label']} currentUser={{type:'user',id:'fixture-user',name:'Fixture',avatarUrl:null}}
    developmentScanProjectId="fixture-only" developmentScanLoading={false}
    developmentScan={{workspacePath:'/fixture',contexts:[{type:'branch',branch:'develop'},{type:'branch',branch:'manual'},{type:'worktree',path:'/fixture',branch:'develop'}]}}
    onCreateLabel={async()=>{}} onCancel={()=>setOpen(false)}
    onSave={async draft=>{setSaved(draft);setOpen(false);}}/>}</>;
}
await initializeTaskboardStorage();
createRoot(document.getElementById('root')!).render(<Fixture/>);
