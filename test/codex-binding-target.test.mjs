import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {verifyDesktopOwner,bindingFromDesktopRead,desktopReadExpression} from '../server/codex-binding-target.mjs';

const executable='/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
const input={threadId:'exact-thread',workspacePath:'/synthetic/project'};
const value=()=>({thread:{thread:{id:input.threadId,cwd:input.workspacePath}},projects:{p1:{rootPaths:[input.workspacePath]}},assignments:{[input.threadId]:{projectId:'p1',cwd:input.workspacePath}}});

test('desktop listener requires loopback and one configured executable family',()=>{
  const table=`100 1 ${executable}\n101 100 /helper\n200 1 /other`;
  assert.equal(verifyDesktopOwner(9229,'p100\nn127.0.0.1:9229\np101\nn[::1]:9229',table,executable),'100');
  for(const listeners of ['p100\nn*:9229','p200\nn127.0.0.1:9229','p100\nn127.0.0.1:9229\np200\nn127.0.0.1:9229','']) {
    assert.throws(()=>verifyDesktopOwner(9229,listeners,table,executable),/DESKTOP_UNAVAILABLE/);
  }
});

test('binding requires exact thread and explicit matching native project assignment',()=>{
  assert.equal(bindingFromDesktopRead(input,value()).codexProjectId,'p1');
  for(const mutate of [
    v=>v.thread.thread.id='other',v=>v.thread.thread.cwd='/other',
    v=>v.assignments={},v=>v.assignments[input.threadId].projectId='missing',
    v=>v.assignments[input.threadId].cwd='/other',v=>v.projects.p1.rootPaths=['/other'],
  ]) {const v=value();mutate(v);assert.throws(()=>bindingFromDesktopRead(input,v),/TARGET_MISMATCH/);}
});

function renderer(url='app://-') {
  const listeners=new Set(),messages=[],snapshot=value();
  const location=new URL(url);
  const window={location,setTimeout,clearTimeout,addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
  window.top=window;
  const reply=(data,source=null,origin='')=>{
    for(const receive of [...listeners]) receive({data,source,origin,stopImmediatePropagation(){}});
  };
  window.electronBridge={sendMessageFromView(message) {
    messages.push(message);
    queueMicrotask(()=>{
      if(message.type==='mcp-request') {
        // An attacker-controlled frame gets the same request id but wrong data.
        reply({type:'mcp-response',hostId:'local',message:{id:message.request.id,result:{thread:{id:'forged'}}}},{},'https://attacker.example');
        reply({type:'mcp-response',hostId:'local',message:{id:message.request.id,result:snapshot.thread}});
      } else {
        const key=JSON.parse(message.body).key;
        const selected=key==='local-projects'?snapshot.projects:snapshot.assignments;
        reply({type:'fetch-response',requestId:message.requestId,status:200,bodyJsonString:JSON.stringify({value:selected})});
      }
    });
  }};
  return {window,messages,listeners};
}

test('renderer sends only three fixed reads and ignores forged foreign-frame responses',async()=>{
  const env=renderer();
  const actual=await vm.runInNewContext(desktopReadExpression(input.threadId,'synthetic-nonce'),{window:env.window});
  assert.deepEqual(JSON.parse(JSON.stringify(actual)),value());
  assert.equal(env.listeners.size,0);
  assert.equal(env.messages.length,3);
  const rpc=env.messages.find(item=>item.type==='mcp-request');
  assert.equal(rpc.request.method,'thread/read');assert.equal(rpc.request.params.includeTurns,false);
  assert.deepEqual(env.messages.filter(item=>item.type==='fetch').map(item=>JSON.parse(item.body).key),['local-projects','thread-project-assignments']);
});

test('remote document and child frame cannot call the native bridge',async()=>{
  for(const env of [renderer('https://attacker.example'),renderer()]) {
    if(env.window.location.protocol==='app:') env.window.top={};
    assert.equal(await vm.runInNewContext(desktopReadExpression(input.threadId),{window:env.window}),undefined);
    assert.equal(env.messages.length,0);
  }
});

test('transport cancellation rejects all pending reads and closes the socket',{timeout:5000},async t=>{
  const {WebSocketServer}=await import('ws');
  const {once}=await import('node:events');
  const {connectBindingCdp}=await import('../server/codex-binding-target.mjs');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  t.after(()=>{for(const socket of server.clients) socket.terminate();server.close();});
  const controller=new AbortController();
  const accepted=once(server,'connection');
  const cdp=await connectBindingCdp(`ws://127.0.0.1:${server.address().port}`,controller.signal);
  const [socket]=await accepted;
  const closed=once(socket,'close');
  const pending=Promise.allSettled([cdp.send('Page.getFrameTree'),cdp.send('Runtime.evaluate')]);
  controller.abort();
  assert.deepEqual((await pending).map(item=>item.status),['rejected','rejected']);
  await closed;
});

test('transport premature socket close rejects pending reads',{timeout:5000},async t=>{
  const {WebSocketServer}=await import('ws');const {once}=await import('node:events');
  const {connectBindingCdp}=await import('../server/codex-binding-target.mjs');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  t.after(()=>{for(const socket of server.clients) socket.terminate();server.close();});
  const accepted=once(server,'connection');
  const cdp=await connectBindingCdp(`ws://127.0.0.1:${server.address().port}`,new AbortController().signal);
  const [socket]=await accepted;
  const rejected=assert.rejects(cdp.send('Page.getFrameTree'),/DESKTOP_UNAVAILABLE/);
  socket.close();await rejected;
});

test('cancel during websocket handshake exits without waiting for server upgrade',{timeout:5000},async t=>{
  const {createServer}=await import('node:http');const {once}=await import('node:events');
  const {connectBindingCdp}=await import('../server/codex-binding-target.mjs');
  const server=createServer();const sockets=new Set();
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('upgrade',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{for(const socket of sockets) socket.destroy();server.close();});
  const controller=new AbortController();
  const upgrade=once(server,'upgrade');
  const connecting=connectBindingCdp(`ws://127.0.0.1:${server.address().port}`,controller.signal);
  const rejected=assert.rejects(connecting,/DESKTOP_UNAVAILABLE/);
  await upgrade;controller.abort();await rejected;
});

test('frame navigation or listener owner drift refuses the completed native read',async()=>{
  const {readBindingViaCdp}=await import('../server/codex-binding-target.mjs');
  for(const scenario of ['ok','frame','loader','owner']) {
    let reads=0;
    const cdp={async send(method) {
      if(method==='Runtime.evaluate') return {result:{value:value()}};
      const second=reads++>0;
      return {frameTree:{frame:{url:'app://-',id:second&&scenario==='frame'?'new':'frame',loaderId:second&&scenario==='loader'?'new':'loader'}}};
    }};
    const result=readBindingViaCdp(cdp,input,async()=>scenario!=='owner');
    if(scenario==='ok') assert.equal((await result).threadId,input.threadId);
    else await assert.rejects(result,/DESKTOP_UNAVAILABLE/);
  }
});
