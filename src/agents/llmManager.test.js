import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMManager } from './llmManager.js';
import { createEnvelope } from '../core/protocol.js';

test('llm manager falls back when active provider unhealthy', async () => {
  const manager = new LLMManager();
  manager.switchProvider('online');
  manager.setProviderHealth('online', false);
  manager.setProviderHealth('local', true);

  const envelope = createEnvelope({
    source: 'test',
    target: 'LLM Manage',
    stage: 'llm',
    payload: { prompt: 'hi' }
  });

  const res = await manager.run(envelope);
  assert.equal(res.ok, true);
  assert.equal(res.result.activeProvider, 'local');
});

test('llm manager health probe start/stop works', () => {
  const manager = new LLMManager();
  const started = manager.startHealthProbe(1000);
  const stopped = manager.stopHealthProbe();

  assert.equal(started, true);
  assert.equal(stopped, true);
});
