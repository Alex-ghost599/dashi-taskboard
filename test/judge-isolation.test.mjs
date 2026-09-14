import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateJudgeTools, validateRejections, judgeProbeConfig } from '../shared/judge-isolation.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/judge-tools-0.153.3.json', import.meta.url)));
test('only the reviewed complete tool schemas are accepted; additions and changes fail closed', () => {
  assert.equal(validateJudgeTools(fixture), true);
  assert.equal(validateJudgeTools([...fixture, {type:'function',name:'exec_command'}]), false);
  const changed=structuredClone(fixture);changed[0].parameters.properties.extra={type:'string'};
  assert.equal(validateJudgeTools(changed), false);
  assert.equal(validateJudgeTools([fixture[0],fixture[0]]), false);
  assert.equal(validateJudgeTools(null), false);
});
test('rejection must match each call id and exact unsupported-tool failure; absence or success cannot pass', () => {
  const calls=[{callId:'one',name:'exec_command'},{callId:'two',name:'spawn_agent'}];
  const outputs=calls.map(c=>({type:'function_call_output',call_id:c.callId,output:`unsupported call: ${c.name}`}));
  assert.equal(validateRejections(calls,outputs), true);
  assert.equal(validateRejections(calls,outputs.slice(1)), false);
  assert.equal(validateRejections(calls,[...outputs,{...outputs[0],output:'ok'}]), false);
  assert.equal(validateRejections(calls,outputs.map(o=>({...o,output:'success'}))), false);
});
test('probe provider is local, never inherits account auth, disables execution channels', () => {
  assert.throws(()=>judgeProbeConfig('https://example.com'));
  assert.throws(()=>judgeProbeConfig('http://127.0.0.1:80/other'));
  const s=judgeProbeConfig('http://127.0.0.1:12345/v1');
  assert.match(s,/requires_openai_auth = false/);assert.match(s,/shell_tool = false/);
  assert.match(s,/hooks = false/);assert.match(s,/enabled = false/);assert.match(s,/web_search = "disabled"/);
});
