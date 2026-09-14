import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runJudgeIsolationProbe } from '../scripts/judge-isolation-probe.mjs';
import { CodexAppServer } from '../server/codex-app-server.mjs';
const tools = JSON.parse(readFileSync(new URL('./fixtures/judge-tools-0.153.3.json', import.meta.url)));
function executable(t, mode='ok') {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(),'judge-fake-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const file = path.join(root,'codex.mjs'), receipt=path.join(root,'receipt.json');
  writeFileSync(file, `import fs from 'node:fs';import readline from 'node:readline';
const mode=${JSON.stringify(mode)},tools=${JSON.stringify(tools)};
if(process.argv.includes('--version')){console.log(mode==='version'?'codex-cli 0.0.0':'codex-cli 0.153.3');process.exit(0);}
const send=o=>process.stdout.write(JSON.stringify(o)+'\\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);if(!m.id)return;
 if(m.method==='initialize')return send({id:m.id,result:{}});
 if(m.method==='inspect')return send({id:m.id,result:{cwd:process.cwd()}});
 if(m.method==='thread/start'){
 fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({cwd:process.cwd(),home:process.env.HOME,env:process.env}));
 return send({id:m.id,result:{thread:{id:'synthetic'},model:'gpt-5.3-codex-spark',modelProvider:'judge_probe',reasoningEffort:'low',approvalPolicy:'never',sandbox:{type:mode==='sandbox'?'dangerFullAccess':'readOnly',networkAccess:false},cwd:process.cwd(),instructionSources:[]}});
 }
 send({id:m.id,result:{}});
 if(m.method==='turn/start'){
 if(mode==='timeout')return;
 const config=fs.readFileSync(process.env.CODEX_HOME+'/config.toml','utf8');const url=config.match(/base_url = "([^"]+)"/)[1];const input=[];
 if(mode==='tools')tools.push({type:'function',name:'exec_command'});
 for(let i=0;i<13;i++){
 const r=await fetch(url+'/responses',{method:'POST',headers:mode==='auth'?{Authorization:'Bearer synthetic-only'}:{},body:JSON.stringify({model:'gpt-5.3-codex-spark',reasoning:{effort:'low'},tools,input})});
 if(!r.ok)return send({method:'turn/completed',params:{turn:{status:'failed'}}});
 const events=(await r.text()).split('\\n').filter(x=>x.startsWith('data:')).map(x=>JSON.parse(x.slice(5)));
 const item=events.find(e=>e.type==='response.output_item.done').item;
 if(item.type==='function_call'){
 let output=mode==='success'?'ok':'unsupported call: '+item.name;
 if(item.namespace==='skills' && item.name==='list')output=JSON.stringify({skills:mode==='inventory'?[{name:'unexpected'}]:[],warnings:[],next_cursor:null});
 if(item.namespace==='skills' && item.name==='read')output=mode==='read'?fs.readFileSync(JSON.parse(item.arguments).resource,'utf8'):'skill package is not available';
 if(item.name==='request_user_input')output=mode==='input'?'accepted':'request_user_input is unavailable in Default mode';
 input.push({type:'function_call_output',call_id:item.call_id,output});
 }
 }
 send({method:'turn/completed',params:{turn:{status:'completed'}}});
 }
});`);
  return { file, receipt, root };
}
test('probe rejects all five calls, uses isolated spawn cwd/env and removes only its temporary runtime', async t=>{
  const f=executable(t);const result=await runJudgeIsolationProbe({executable:f.file});
  assert.equal(result.syntheticRequests,13);assert.equal(result.authorizesDispatch,false);
  assert.equal(result.skillsReadConfinementVerified,false);
  assert.equal(result.emptySkillInventoryVerified,true);assert.equal(result.defaultModeInputRejected,true);
  const receipt=JSON.parse(readFileSync(f.receipt));
  assert.equal(path.dirname(receipt.cwd),path.dirname(receipt.home));
  assert.equal(receipt.env.CODEX_HOME,receipt.home);
  assert.equal(receipt.env.OPENAI_API_KEY,undefined);assert.equal(receipt.env.CODEX_TASKBOARD_URL,undefined);
  assert.equal(existsSync(receipt.home),false);assert.equal(existsSync(f.root),true);
});
for(const mode of ['sandbox','tools','success','inventory','read','input','auth','timeout'])test(`probe fails closed for ${mode} mismatch`,{timeout:30000},async t=>{
  const f=executable(t,mode);await assert.rejects(runJudgeIsolationProbe({executable:f.file}));
  const receipt=JSON.parse(readFileSync(f.receipt));assert.equal(existsSync(receipt.home),false);
});
test('shared app-server preserves inherited cwd by default and honors explicit cwd',async t=>{
  const f=executable(t);
  for(const cwd of [undefined,f.root]){
    const client=new CodexAppServer({executable:f.file,cwd});
    try{assert.equal((await client.request('inspect',{})).cwd,cwd??process.cwd());}finally{await client.close();}
  }
});

test('unreviewed CLI version cannot start app-server',async t=>{const f=executable(t,'version');await assert.rejects(runJudgeIsolationProbe({executable:f.file}));assert.equal(existsSync(f.receipt),false);});
