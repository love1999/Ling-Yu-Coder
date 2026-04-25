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
  assert.ok(res.result.healthMetrics);
});

test('llm manager health probe start/stop works', () => {
  const manager = new LLMManager();
  const started = manager.startHealthProbe(1000);
  const stopped = manager.stopHealthProbe();

  assert.equal(started, true);
  assert.equal(stopped, true);
});

test('llm manager opens circuit after consecutive failures', async () => {
  const manager = new LLMManager({ failureThreshold: 2, cooldownMs: 1000 });
  manager.setProviderHealth('online', false);

  await manager.checkProviderHealth('online');
  await manager.checkProviderHealth('online');

  const provider = manager.listProviders().online;
  assert.equal(provider.state, 'open');
  assert.equal(manager.isProviderAvailable('online'), false);
  assert.equal(manager.getHealthMetrics().openedCircuits, 1);
});

test('llm manager allows provider again after cooldown', async () => {
  const manager = new LLMManager({ failureThreshold: 1, cooldownMs: 5 });
  manager.setProviderHealth('online', false);

  await manager.checkProviderHealth('online');
  assert.equal(manager.listProviders().online.state, 'open');

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(manager.isProviderAvailable('online'), true);
  assert.equal(manager.listProviders().online.state, 'degraded');
  assert.equal(manager.getHealthMetrics().recoveredCircuits, 1);
});

test('llm manager metrics track probe success rate', async () => {
  const manager = new LLMManager();
  manager.setProviderHealth('online', true);
  manager.setProviderHealth('local', false);

  await manager.probeAllProviders();
  const metrics = manager.getHealthMetrics();

  assert.equal(metrics.totalProbes, 2);
  assert.equal(metrics.successfulProbes, 1);
  assert.equal(metrics.failedProbes, 1);
  assert.equal(metrics.probeSuccessRate, 0.5);
});
