import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function judgeReadCalls({ outside, link }) {
  const calls = [
    ...['orchestrator', 'executor'].map(kind => ({ name: 'list', namespace: 'skills', kind: 'emptySkills', arguments: { authority: { kind } } })),
    ...[
      { package: outside, resource: path.join(outside, 'SKILL.md') },
      { package: outside, resource: '../../outside/SKILL.md' },
      { package: pathToFileURL(outside).href, resource: pathToFileURL(path.join(outside, 'SKILL.md')).href },
      { package: link, resource: 'SKILL.md' },
    ].map(args => ({ name: 'read', namespace: 'skills', kind: 'unavailableSkill', arguments: args })),
    { name: 'request_user_input', kind: 'unavailableInput', arguments: { questions: [{ id: 'synthetic', header: 'Probe', question: 'Synthetic test?',
      options: [{ label: 'A', description: 'Synthetic A' }, { label: 'B', description: 'Synthetic B' }] }] } },
  ];
  return calls.map((call, i) => ({ ...call, callId: `judge_read_${i}` }));
}
export function validateReadReceipts(calls, outputs) {
  return calls.length > 0 && calls.every(call => {
    const matches = outputs.filter(o => o?.type === 'function_call_output' && o.call_id === call.callId);
    if (matches.length !== 1) return false;
    const output = matches[0].output;
    if (call.kind === 'unavailableSkill') return output === 'skill package is not available';
    if (call.kind === 'unavailableInput') return output === 'request_user_input is unavailable in Default mode';
    if (call.kind !== 'emptySkills') return false;
    try {
      const result = JSON.parse(output);
      return result && Object.keys(result).sort().join(',') === 'next_cursor,skills,warnings'
        && Array.isArray(result.skills) && result.skills.length === 0
        && Array.isArray(result.warnings) && result.warnings.length === 0 && result.next_cursor === null;
    } catch { return false; }
  });
}
