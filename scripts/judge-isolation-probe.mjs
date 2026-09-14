#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, access, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CodexAppServer } from '../server/codex-app-server.mjs';
import { executableCommand } from '../shared/executable-command.mjs';
import { judgeProbeConfig, validateJudgeTools, validateRejections } from '../shared/judge-isolation.mjs';

const ATTACKS = ['exec_command', 'shell', 'apply_patch', 'spawn_agent', 'mcp__unconfigured__write_file'];
const LIMIT = 1024 * 1024;
// This entry point can only run a synthetic provider. It has no credential option.
export async function runJudgeIsolationProbe({ executable }) {
  if (!path.isAbsolute(executable ?? '')) throw new Error('Absolute trusted executable required');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dashi-judge-probe-')));
  const home = path.join(root, 'home'), cwd = path.join(root, 'workspace');
  let client, server, timer;
  try {
    await mkdir(home, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    const env = { HOME: home, CODEX_HOME: home, XDG_CONFIG_HOME: home,
      XDG_DATA_HOME: home, XDG_CACHE_HOME: home, TMPDIR: root,
      PATH: process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32') : '/usr/bin:/bin:/usr/sbin:/sbin' };
    if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const command = executableCommand(executable, ['--version']);
    const version = (await promisify(execFile)(command.executable, command.args, {
      env, cwd, timeout: 5000, maxBuffer: 4096, encoding: 'utf8',
    })).stdout.trim();
    if (version !== 'codex-cli 0.153.3') throw new Error('Unreviewed CLI version');
    const calls = ATTACKS.map((name, index) => ({ name, callId: `judge_probe_${index}` }));
    const outputs = new Map(); let requests = 0;
    let resolveDone, rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    // Attach a handler before startup can fail; the same promise is awaited below.
    done.catch(() => {});
    server = createServer(async (req, res) => {
      try {
        if (req.method !== 'POST' || req.url !== '/v1/responses' || req.headers.authorization) throw new Error('Unexpected provider request');
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > LIMIT) throw new Error('Request too large'); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        requests += 1;
        if (requests > calls.length + 1 || body.model !== 'gpt-5.3-codex-spark'
          || body.reasoning?.effort !== 'low' || !validateJudgeTools(body.tools)) throw new Error('Unexpected model or tool schema');
        for (const item of body.input ?? []) {
          if (item.type !== 'function_call_output') continue;
          const previous = outputs.get(item.call_id);
          if (previous && previous.output !== item.output) throw new Error('Conflicting receipt');
          outputs.set(item.call_id, item);
        }
        if (requests > 1 && !validateRejections(calls.slice(0, requests - 1), [...outputs.values()])) throw new Error('Missing explicit tool rejection');
        const attack = calls[requests - 1];
        const item = attack ? { type: 'function_call', id: `fc_${requests}`, call_id: attack.callId,
          name: attack.name, arguments: JSON.stringify({ cmd: `echo forbidden > ${path.join(cwd, 'write-canary')}`,
            command: `echo forbidden > ${path.join(cwd, 'write-canary')}`, path: path.join(cwd, 'write-canary'), content: 'forbidden' }) }
          : { type: 'message', id: 'probe_message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'synthetic probe complete' }] };
        const response = { id: `probe_response_${requests}`, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
        const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
          { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
      } catch {
        res.writeHead(400); res.end('Synthetic probe rejected request');
        rejectDone(new Error('Synthetic provider contract failed'));
      }
    });
    server.requestTimeout = 5000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await writeFile(path.join(home, 'config.toml'), judgeProbeConfig(`http://127.0.0.1:${server.address().port}/v1`), { mode: 0o600 });
    client = new CodexAppServer({ executable, processEnv: env, cwd, requestTimeoutMs: 10_000 });
    client.subscribe(event => { if (event.method === 'turn/completed') resolveDone(event.params); });
    timer = setTimeout(() => rejectDone(new Error('Synthetic probe deadline exceeded')), 20_000);
    const started = await client.startThread({ model: 'gpt-5.3-codex-spark', cwd, ephemeral: true,
      approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], environments: [], selectedCapabilityRoots: [],
      config: { model_reasoning_effort: 'low' } });
    if (started.model !== 'gpt-5.3-codex-spark' || started.modelProvider !== 'judge_probe'
      || started.reasoningEffort !== 'low' || started.approvalPolicy !== 'never'
      || started.sandbox?.type !== 'readOnly' || started.sandbox.networkAccess !== false
      || started.cwd !== cwd || started.instructionSources?.length !== 0) throw new Error('Unexpected effective thread configuration');
    await client.startTurn({ threadId: started.thread.id, input: [{ type: 'text', text: 'Synthetic isolation test only.', text_elements: [] }], effort: 'low' });
    const completed = await done;
    const canaryCreated = await access(path.join(cwd, 'write-canary')).then(() => true, () => false);
    if (completed?.turn?.status !== 'completed' || requests !== calls.length + 1
      || !validateRejections(calls, [...outputs.values()]) || canaryCreated) throw new Error('Incomplete negative proof');
    return { schemaVersion: 1, cliVersion: version, status: 'synthetic_tool_rejections_verified',
      authorizesDispatch: false, realModelCalls: 0, credentialsUsed: false, syntheticRequests: requests,
      rejectedTools: calls.map(call => ({ name: call.name, callId: call.callId, output: outputs.get(call.callId).output })),
      observedTools: ['request_user_input', 'skills.list', 'skills.read'], canaryCreated,
      skillsReadConfinementVerified: false, authenticatedModelVerified: false, productionJudgeVerified: false };
  } finally {
    clearTimeout(timer);
    await client?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/judge-isolation-probe.mjs --codex /absolute/trusted/codex\nRuns only a local synthetic provider; no account credentials or real model calls. CLI 0.153.3 required.');
  } else {
    try {
      if (args.length !== 2 || args[0] !== '--codex') throw new Error('Invalid arguments');
      console.log(JSON.stringify(await runJudgeIsolationProbe({ executable: args[1] })));
    } catch {
      console.log(JSON.stringify({ status: 'probe_failed', authorizesDispatch: false, realModelCalls: 0 }));
      process.exitCode = 1;
    }
  }
}
