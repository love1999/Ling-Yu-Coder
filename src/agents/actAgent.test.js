import test from 'node:test';
import assert from 'node:assert/strict';

import { ActAgent } from './actAgent.js';
import { createEnvelope } from '../core/protocol.js';

test('act agent appends marker for normal mode', async () => {
  const agent = new ActAgent();
  const envelope = createEnvelope({
    source: 'test',
    target: 'Act Agent',
    stage: 'act',
    payload: { code: 'const a = 1;' }
  });

  const res = await agent.run(envelope);
  assert.equal(res.ok, true);
  assert.match(res.result.updatedCode, /Act Agent 执行标记/);
});

test('act agent repairs syntax/runtime anti-patterns', async () => {
  const agent = new ActAgent();
  const envelope = createEnvelope({
    source: 'test',
    target: 'Act Agent',
    stage: 'act',
    payload: {
      repair: true,
      code: 'const broken = ;\nthrow new Error("x");',
      diagnostics: [{ message: 'Unexpected token (1:14)' }],
      runtimeFailures: ['boom']
    }
  });

  const res = await agent.run(envelope);
  assert.equal(res.ok, true);
  assert.match(res.result.updatedCode, /const broken = null;/);
  assert.doesNotMatch(res.result.updatedCode, /throw new Error/);
});
