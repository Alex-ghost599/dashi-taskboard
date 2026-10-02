import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {previewProjectConversations,readProjectConversationSource} from '../server/conversation-import-preview.mjs';

const threadId='11111111-1111-4111-8111-111111111111';
async function fixture(check) {
  const root=await mkdtemp(path.join(os.tmpdir(),'dashi-source-read-'));
  const sessionsRoot=path.join(root,'sessions');
  const file=path.join(sessionsRoot,'2026','10','02','source.jsonl');
  const project={id:'synthetic',workspacePath:path.join(root,'project')};
  const text=JSON.stringify({type:'session_meta',payload:{id:threadId,cwd:project.workspacePath}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Synthetic request'}]}})+'\n';
  try {
    await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);
    const preview=await previewProjectConversations({sessionsRoot,project});
    const sourceFile=preview.candidates[0].sourceFiles[0];
    await check({sessionsRoot,project,threadId,sourceFile,file,text,root});
  } finally {await rm(root,{recursive:true,force:true});}
}
test('selected source returns exact bytes and project evidence without a task binding',async()=>fixture(async input=>{
  const result=await readProjectConversationSource(input);
  assert.equal(result.buffer.toString(),input.text);
  assert.equal(result.evidence.threadId,threadId);
  assert.equal(result.evidence.projectId,'synthetic');
  assert.equal(result.authorizesDispatch,false);
}));
test('client cannot select an arbitrary file outside enumerated project sources',async()=>fixture(async input=>{
  await assert.rejects(readProjectConversationSource({...input,sourceFile:{...input.sourceFile,path:'../../outside.jsonl'}}),/SOURCE_NOT_SELECTED/);
}));
test('a stale metadata hash requires refreshing the source selection',async()=>fixture(async input=>{
  await writeFile(input.file,input.text.replace('session_meta','invalid_meta'));
  await assert.rejects(readProjectConversationSource(input),/SOURCE_NOT_SELECTED/);
}));
test('a different project cannot read selected conversation text',async()=>fixture(async input=>{
  await assert.rejects(readProjectConversationSource({...input,project:{...input.project,workspacePath:path.join(input.root,'other')}}),/SOURCE_NOT_SELECTED/);
}));
test('oversize source is rejected without returning body text',async()=>fixture(async input=>{
  await assert.rejects(readProjectConversationSource({...input,maxBytes:16}),/SOURCE_SIZE_LIMIT/);
}));
test('source replacement by symlink is refused',async()=>fixture(async input=>{
  const outside=path.join(input.root,'outside.jsonl');await writeFile(outside,input.text);
  await rm(input.file);await symlink(outside,input.file);
  await assert.rejects(readProjectConversationSource(input),/SOURCE_NOT_SELECTED/);
}));
test('aborted selected read fails without returning partial body',async()=>fixture(async input=>{
  const controller=new AbortController();controller.abort(new Error('Synthetic cancelled'));
  await assert.rejects(readProjectConversationSource({...input,signal:controller.signal}),/Synthetic cancelled/);
}));
