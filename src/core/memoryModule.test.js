import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryModule } from './memoryModule.js';
import { createEnvelope } from './protocol.js';

test('memory module applies maxNotes pruning', async () => {
  let saved = null;
  const api = {
    async loadMemory() {
      return {
        notes: [
          { summary: '1', ts: Date.now() - 1000 },
          { summary: '2', ts: Date.now() - 1000 },
          { summary: '3', ts: Date.now() - 1000 }
        ],
        decisions: [],
        contexts: [],
        archive: []
      };
    },
    async saveMemory(next) {
      saved = next;
    }
  };

  const module = new MemoryModule(api);
  const envelope = createEnvelope({
    source: 'test',
    target: 'Memory Module',
    stage: 'memory',
    payload: {
      entry: { summary: '4' },
      options: { maxNotes: 2, ttlDays: 999 }
    }
  });

  const res = await module.run(envelope);
  assert.equal(res.ok, true);
  assert.equal(saved.notes.length, 2);
});

test('memory module archives expired notes', async () => {
  let saved = null;
  const api = {
    async loadMemory() {
      return {
        notes: [
          { summary: 'old', ts: Date.now() - 40 * 24 * 60 * 60 * 1000 },
          { summary: 'new', ts: Date.now() - 1000 }
        ],
        archive: []
      };
    },
    async saveMemory(next) {
      saved = next;
    }
  };

  const module = new MemoryModule(api);
  const envelope = createEnvelope({
    source: 'test',
    target: 'Memory Module',
    stage: 'memory',
    payload: {
      entry: { summary: 'latest' },
      options: { ttlDays: 30, maxArchive: 10 }
    }
  });

  const res = await module.run(envelope);
  assert.equal(res.ok, true);
  assert.equal(saved.archive.length, 1);
  assert.equal(res.result.archivedInThisRun, 1);
});
