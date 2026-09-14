import { createHash } from 'node:crypto';
// Exact schemas observed with CLI 0.153.3 and the synthetic provider only.
// Accepting them is not proof that skills.read is confined to a safe data source.
const TOOL_HASHES = new Map([
  ['request_user_input', 'd966b55e964da3155fb6956528a375b7cea02b3fc189086b7d9225f4d025fa6c'],
  ['skills', 'b676079f96b413f65588729bea350c18c091af56d5acd3d16b154547b3019010'],
]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function validateJudgeTools(tools) {
  return Array.isArray(tools) && tools.length === TOOL_HASHES.size
    && new Set(tools.map(t => t?.name)).size === tools.length
    && tools.every(t => TOOL_HASHES.get(t?.name) === createHash('sha256').update(JSON.stringify(canonical(t))).digest('hex'));
}
export function validateRejections(calls, outputs) {
  return calls.length > 0 && calls.every(call => {
    const matches = outputs.filter(o => o?.type === 'function_call_output' && o.call_id === call.callId);
    return matches.length === 1 && matches[0].output === `unsupported call: ${call.name}`;
  });
}
export function judgeProbeConfig(baseUrl) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/v1$/.test(baseUrl)
    || Number(new URL(baseUrl).port) > 65535) throw new Error('Invalid synthetic provider address');
  return `model_provider = "judge_probe"
model = "gpt-5.3-codex-spark"
model_reasoning_effort = "low"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[agents]
enabled = false
[features]
apps = false
plugins = false
remote_plugin = false
hooks = false
shell_tool = false
browser_use = false
browser_use_external = false
computer_use = false
code_mode = false
code_mode_host = false
multi_agent = false
skill_search = false
skill_mcp_dependency_install = false
skip_host_skill_discovery = true
goals = false
sleep_tool = false
request_permissions_tool = false
enable_request_compression = false
[tools]
view_image = false
[model_providers.judge_probe]
name = "Local synthetic judge probe"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
`;
}
