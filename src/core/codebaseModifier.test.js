import test from 'node:test';
import assert from 'node:assert/strict';

import { CodebaseModifier } from './codebaseModifier.js';
import { createEnvelope } from './protocol.js';

test('codebase modifier forwards options and normalizes fields', async () => {
  let captured = null;
  const api = {
    async modifyCodebase(payload) {
      captured = payload;
      return {
        applied: ['a.txt'],
        failed: [],
        rolledBack: false,
        dryRun: true,
        root: '/tmp/x'
      };
    }
  };

  const module = new CodebaseModifier(api);
  const envelope = createEnvelope({
    source: 'test',
    target: 'Codebase Modifier',
    stage: 'modify',
    payload: {
      root: '/tmp/x',
      changes: [{ path: 'a.txt', content: '1' }],
      options: { transactional: true, dryRun: true }
    }
  });

  const res = await module.run(envelope);
  assert.equal(res.ok, true);
  assert.equal(captured.options.transactional, true);
  assert.equal(res.result.dryRun, true);
});
