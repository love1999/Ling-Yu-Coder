import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { registerIpcHandlers } from './ipcHandlers.js';

const createIpcHarness = (paths = {}, overrides = {}) => {
  const handlers = new Map();
  const ipcMain = {
    handle: (name, fn) => handlers.set(name, fn)
  };

  const app = {
    getPath: (key) => paths[key],
    getVersion: () => '0.1.0'
  };

  const dialog = {
    showMessageBox: async () => ({ response: 1 })
  };

  const llmManager = overrides.llmManager || {
    active: 'online',
    listProviders: () => ({
      online: { healthy: true, state: 'healthy' },
      local: { healthy: true, state: 'healthy' }
    }),
    getHealthMetrics: () => ({
      totalProbes: 0,
      successfulProbes: 0,
      failedProbes: 0,
      openedCircuits: 0,
      recoveredCircuits: 0,
      probeSuccessRate: 1
    }),
    probeAllProviders: async () => ({
      providers: {
        online: { healthy: true, state: 'healthy' },
        local: { healthy: true, state: 'healthy' }
      },
      metrics: {
        totalProbes: 2,
        successfulProbes: 2,
        failedProbes: 0,
        openedCircuits: 0,
        recoveredCircuits: 0,
        probeSuccessRate: 1
      }
    })
  };

  const httpPost = overrides.httpPost || (async () => ({ ok: true, status: 200 }));

  registerIpcHandlers({ ipcMain, app, dialog, llmManager, httpPost });

  const invoke = async (name, payload) => handlers.get(name)({}, payload);

  return { invoke };
};

test('ipcHandlers: environment inspect returns expected shape', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('environment:inspect');
  assert.ok(result.platform);
  assert.ok(result.node);
});

test('ipcHandlers: memory save/load roundtrip works', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  await harness.invoke('memory:save', { notes: [{ x: 1 }], decisions: [], contexts: [] });
  const loaded = await harness.invoke('memory:load');

  assert.equal(loaded.notes.length, 1);
});

test('ipcHandlers: runtime run captures error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('runtime:run', 'throw new Error("boom")');
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});

test('ipcHandlers: runtime run returns timeout error for infinite loop', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('runtime:run', 'while(true){}');
  assert.equal(result.ok, false);
  assert.match(result.error, /Script execution timed out/);
});

test('ipcHandlers: codebase modify uses default documents root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('codebase:modify', {
    root: '',
    changes: [{ path: 'a.txt', content: 'hello' }],
    options: { transactional: true }
  });

  assert.equal(result.ok, true);
  const content = await fs.readFile(path.join(root, 'a.txt'), 'utf8');
  assert.equal(content, 'hello');
});

test('ipcHandlers: llm health returns provider and metrics snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('llm:health');
  assert.equal(result.ok, true);
  assert.equal(result.active, 'online');
  assert.equal(result.providers.online.state, 'healthy');
  assert.equal(result.metrics.probeSuccessRate, 1);
});

test('ipcHandlers: llm probe runs and returns report', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('llm:probe');
  assert.equal(result.ok, true);
  assert.equal(result.providers.local.healthy, true);
  assert.equal(result.metrics.totalProbes, 2);
});

test('ipcHandlers: webhook alert posts payload when url is valid', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const requests = [];
  const harness = createIpcHarness(
    { userData: root, documents: root },
    {
      httpPost: async (url, init) => {
        requests.push({ url, init });
        return { ok: true, status: 204 };
      }
    }
  );

  const result = await harness.invoke('alert:webhook', {
    url: 'https://example.com/hook',
    event: 'llm.health.warn',
    data: { x: 1 },
    token: 'abc',
    secret: 'secret'
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.com/hook');
  assert.ok(requests[0].init.headers['x-lingyu-signature']);
});

test('ipcHandlers: webhook alert rejects invalid url', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const harness = createIpcHarness({ userData: root, documents: root });

  const result = await harness.invoke('alert:webhook', {
    url: 'ftp://invalid',
    event: 'x',
    data: {}
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /invalid webhook url/);
});

test('ipcHandlers: webhook alert retries and falls back to disk queue on failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  let calls = 0;
  const harness = createIpcHarness(
    { userData: root, documents: root },
    {
      httpPost: async () => {
        calls += 1;
        throw new Error('network down');
      }
    }
  );

  const result = await harness.invoke('alert:webhook', {
    url: 'https://example.com/hook',
    event: 'llm.health.warn',
    data: { x: 1 },
    maxRetries: 1,
    backoffMs: 50
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 2);

  const queueRaw = await fs.readFile(path.join(root, 'alert-failed-queue.jsonl'), 'utf8');
  assert.match(queueRaw, /llm\.health\.warn/);
  assert.match(queueRaw, /network down/);
});
