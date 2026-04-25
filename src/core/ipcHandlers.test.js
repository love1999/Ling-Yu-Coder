import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { registerIpcHandlers } from './ipcHandlers.js';

const createIpcHarness = (paths = {}) => {
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

  registerIpcHandlers({ ipcMain, app, dialog });

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
