import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyCodebaseChanges, hashContent } from './applyCodebaseChanges.js';

const makeTempDir = async () => fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-'));

test('applyCodebaseChanges writes files in transactional mode success', async () => {
  const root = await makeTempDir();
  const result = await applyCodebaseChanges({
    root,
    changes: [{ path: 'a.txt', content: 'hello' }],
    options: { transactional: true }
  });

  assert.equal(result.ok, true);
  const content = await fs.readFile(path.join(root, 'a.txt'), 'utf8');
  assert.equal(content, 'hello');
  assert.equal(result.applied[0].path, 'a.txt');
});

test('applyCodebaseChanges rolls back when transactional failure occurs', async () => {
  const root = await makeTempDir();
  const file = path.join(root, 'a.txt');
  await fs.writeFile(file, 'before', 'utf8');

  const result = await applyCodebaseChanges({
    root,
    changes: [
      { path: 'a.txt', content: 'after' },
      { path: '../escape.txt', content: 'bad' }
    ],
    options: { transactional: true }
  });

  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  const content = await fs.readFile(file, 'utf8');
  assert.equal(content, 'before');
});

test('applyCodebaseChanges detects expectedHash conflict', async () => {
  const root = await makeTempDir();
  const file = path.join(root, 'a.txt');
  await fs.writeFile(file, 'current', 'utf8');

  const result = await applyCodebaseChanges({
    root,
    changes: [{ path: 'a.txt', content: 'next', expectedHash: hashContent('old') }],
    options: { transactional: false }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /hash 不匹配/);
});

test('applyCodebaseChanges dryRun does not write files', async () => {
  const root = await makeTempDir();
  const result = await applyCodebaseChanges({
    root,
    changes: [{ path: 'a.txt', content: 'hello' }],
    options: { dryRun: true }
  });

  assert.equal(result.ok, true);
  await assert.rejects(() => fs.readFile(path.join(root, 'a.txt'), 'utf8'));
});

test('applyCodebaseChanges patch-merges non-conflicting line changes', async () => {
  const root = await makeTempDir();
  const file = path.join(root, 'a.txt');
  const base = 'line1\nline2\nline3';
  const current = 'line1\nline2-current\nline3';
  const incoming = 'line1\nline2\nline3-incoming';

  await fs.writeFile(file, current, 'utf8');

  const result = await applyCodebaseChanges({
    root,
    changes: [{ path: 'a.txt', content: incoming, baseContent: base, expectedHash: hashContent(base) }],
    options: { mergeStrategy: 'patch' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied[0].merged, true);
  assert.equal(result.applied[0].mergeConflict, false);
  const mergedContent = await fs.readFile(file, 'utf8');
  assert.equal(mergedContent, 'line1\nline2-current\nline3-incoming');
});

test('applyCodebaseChanges patch merge reports conflict when both sides changed same line', async () => {
  const root = await makeTempDir();
  const file = path.join(root, 'a.txt');
  const base = 'same';
  await fs.writeFile(file, 'current-change', 'utf8');

  const result = await applyCodebaseChanges({
    root,
    changes: [{ path: 'a.txt', content: 'incoming-change', baseContent: base, expectedHash: hashContent(base) }],
    options: { mergeStrategy: 'patch' }
  });

  assert.equal(result.ok, false);
  assert.match(result.failed[0].reason, /patch merge conflict/);
});
