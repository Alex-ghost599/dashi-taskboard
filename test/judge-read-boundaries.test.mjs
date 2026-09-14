import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeReadCalls, validateReadReceipts } from '../shared/judge-read-boundaries.mjs';
const calls=judgeReadCalls({outside:'/synthetic/outside',link:'/synthetic/link'});
function receipts(){return calls.map(c=>({type:'function_call_output',call_id:c.callId,output:c.kind==='emptySkills'?JSON.stringify({skills:[],warnings:[],next_cursor:null}):c.kind==='unavailableSkill'?'skill package is not available':'request_user_input is unavailable in Default mode'}));}
test('both Skill authorities and forged package/resource forms are required',()=>{
  assert.deepEqual(calls.filter(c=>c.kind==='emptySkills').map(c=>c.arguments.authority.kind),['orchestrator','executor']);
  assert.equal(calls.filter(c=>c.kind==='unavailableSkill').length,4);
  assert.equal(validateReadReceipts(calls,receipts()),true);
});
test('nonempty skills, pagination, warnings or missing receipts fail closed',()=>{
  for(const change of [{skills:[{name:'unexpected'}],warnings:[],next_cursor:null},{skills:[],warnings:[],next_cursor:'more'},{skills:[],warnings:['unknown'],next_cursor:null}]){
    const outputs=receipts();outputs[0].output=JSON.stringify(change);assert.equal(validateReadReceipts(calls,outputs),false);
  }
  assert.equal(validateReadReceipts(calls,receipts().slice(1)),false);
});
test('successful reads, empty answers and unrelated errors never count as rejection',()=>{
  for(const output of ['synthetic secret','', 'permission denied', '{}']){
    const outputs=receipts();outputs[2].output=output;assert.equal(validateReadReceipts(calls,outputs),false);
  }
  const outputs=receipts();outputs.at(-1).output='accepted';assert.equal(validateReadReceipts(calls,outputs),false);
});
