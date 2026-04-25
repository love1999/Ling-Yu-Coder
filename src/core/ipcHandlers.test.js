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

  const httpPost = overrides.httpPost || (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, ackId: 'ack-default' })
  }));

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
        return {
          ok: true,
          status: 204,
          json: async () => ({ ok: true, ackId: 'ack-1' })
        };
      }
    }
  );

  const result = await harness.invoke('alert:webhook', {
    url: 'https://example.com/hook',
    event: 'llm.health.warn',
    data: { x: 1 },
    token: 'abc',
    secret: 'secret',
    signatureVersions: ['v1']
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 204);
  assert.equal(result.ack.ackId, 'ack-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.com/hook');
  assert.equal(requests[0].init.headers['x-lingyu-signature-version'], 'v1');
  assert.equal(requests[0].init.headers['x-lingyu-signature-accept'], 'v1');
  assert.ok(requests[0].init.headers['x-lingyu-signature']);
  assert.ok(requests[0].init.headers['x-lingyu-timestamp']);
  assert.ok(requests[0].init.headers['x-lingyu-nonce']);
  assert.equal(requests[0].init.headers['x-lingyu-tenant-id'], 'default');
  const body = JSON.parse(requests[0].init.body);
  assert.ok(body.ts);
  assert.ok(body.nonce);
  assert.equal(body.signer.tenantId, 'default');
});

test('ipcHandlers: webhook alert negotiates v2 and resolves tenant key rotation by key-id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  const requests = [];
  const harness = createIpcHarness(
    { userData: root, documents: root },
    {
      httpPost: async (url, init) => {
        requests.push({ url, init });
        return {
          ok: true,
          status: 202,
          json: async () => ({ ok: true, ackId: 'ack-2' })
        };
      }
    }
  );

  const result = await harness.invoke('alert:webhook', {
    url: 'https://example.com/hook',
    event: 'llm.health.warn',
    data: { x: 2 },
    tenantId: 'tenant-a',
    activeKeyIdByTenant: { 'tenant-a': 'kid-2026-04' },
    secretsByTenant: {
      'tenant-a': {
        'kid-2025-12': 'old-secret',
        'kid-2026-04': 'new-secret'
      }
    },
    signatureVersions: ['v2', 'v1']
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.ack.ackId, 'ack-2');
  assert.equal(requests.length, 1);
  const { headers, body } = requests[0].init;
  assert.equal(headers['x-lingyu-signature-version'], 'v2');
  assert.equal(headers['x-lingyu-signature-accept'], 'v2,v1');
  assert.equal(headers['x-lingyu-key-id'], 'kid-2026-04');
  assert.equal(headers['x-lingyu-tenant-id'], 'tenant-a');
  assert.ok(headers['x-lingyu-signature']);
  const parsedBody = JSON.parse(body);
  assert.equal(parsedBody.signer.tenantId, 'tenant-a');
  assert.equal(parsedBody.signer.keyId, 'kid-2026-04');
  assert.equal(parsedBody.signer.versions, 'v2,v1');
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

test('ipcHandlers: webhook alert supports manual ack and deadletter replay flow', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-ipc-'));
  let calls = 0;
  const harness = createIpcHarness(
    { userData: root, documents: root },
    {
      httpPost: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, ackId: 'ack-replayed' })
        };
      }
    }
  );

  const first = await harness.invoke('alert:webhook', {
    url: 'https://example.com/hook',
    event: 'llm.health.warn',
    data: { x: 3 },
    maxRetries: 0
  });
  assert.equal(first.ok, false);
  assert.match(first.reason, /missing webhook ack/);
  assert.ok(first.deliveryId);

  const listed = await harness.invoke('alert:deadletter:list', { limit: 10 });
  assert.equal(listed.ok, true);
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].deliveryId, first.deliveryId);

  const replayed = await harness.invoke('alert:deadletter:replay', { limit: 10, maxRetries: 0 });
  assert.equal(replayed.ok, true);
  assert.equal(replayed.replayed, 1);
  assert.equal(replayed.succeeded, 1);

  const listedAfterReplay = await harness.invoke('alert:deadletter:list', { limit: 10 });
  assert.equal(listedAfterReplay.total, 0);

  const acked = await harness.invoke('alert:webhook:ack', {
    deliveryId: first.deliveryId,
    ackId: 'ack-manual'
  });
  assert.equal(acked.ok, true);
  assert.equal(acked.deliveryId, first.deliveryId);
  assert.equal(acked.ackId, 'ack-manual');
});
