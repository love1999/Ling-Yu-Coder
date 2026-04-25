import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hasPlaywright = async () => {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
};

const sha1 = (content) => createHash('sha1').update(content || '').digest('hex');

test('electron e2e: run pipeline and generate doc', async (t) => {
  if (!(await hasPlaywright())) {
    t.skip('playwright not installed in current environment');
    return;
  }

  const { _electron: electron } = await import('playwright');

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LINGYU_E2E: '1'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#runPipeline');
    await page.click('#runPipeline');

    await page.waitForFunction(() => {
      const text = document.querySelector('#doc')?.textContent || '';
      return text.includes('灵羽执行记录') || text.includes('审批未通过');
    });

    const doc = await page.textContent('#doc');
    assert.ok(doc && doc.length > 0);
  } finally {
    await app.close();
  }
});

test('electron e2e: approval denied path is handled', async (t) => {
  if (!(await hasPlaywright())) {
    t.skip('playwright not installed in current environment');
    return;
  }

  const { _electron: electron } = await import('playwright');

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LINGYU_E2E: '1',
      LINGYU_E2E_APPROVAL: '0'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#runPipeline');
    await page.click('#runPipeline');

    await page.waitForFunction(() => {
      const text = document.querySelector('#doc')?.textContent || '';
      return text.includes('审批未通过');
    });

    const doc = await page.textContent('#doc');
    assert.match(doc || '', /审批未通过/);
  } finally {
    await app.close();
  }
});

test('electron e2e: preload IPC bridge works in real process', async (t) => {
  if (!(await hasPlaywright())) {
    t.skip('playwright not installed in current environment');
    return;
  }

  const { _electron: electron } = await import('playwright');

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LINGYU_E2E: '1'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.lingYuAPI));

    const inspect = await page.evaluate(() => window.lingYuAPI.inspectEnvironment());
    assert.equal(typeof inspect.platform, 'string');
    assert.equal(typeof inspect.node, 'string');

    const memoryPayload = {
      notes: ['e2e-note'],
      decisions: [{ key: 'approval', value: true }],
      contexts: ['e2e-context']
    };
    const saveOk = await page.evaluate((payload) => window.lingYuAPI.saveMemory(payload), memoryPayload);
    assert.equal(saveOk, true);

    const loaded = await page.evaluate(() => window.lingYuAPI.loadMemory());
    assert.deepEqual(loaded, memoryPayload);

    const runtime = await page.evaluate(() => window.lingYuAPI.runSnippet('console.log("ipc-ok")'));
    assert.equal(runtime.ok, true);
    assert.deepEqual(runtime.logs, ['ipc-ok']);

    const timeout = await page.evaluate(() => window.lingYuAPI.runSnippet('while(true){}'));
    assert.equal(timeout.ok, false);
    assert.match(timeout.error || '', /Script execution timed out/);

    const approved = await page.evaluate(() => window.lingYuAPI.requestApproval('E2E approval'));
    assert.equal(approved, true);

    const health = await page.evaluate(() => window.lingYuAPI.getLLMHealth());
    assert.equal(health.ok, true);
    assert.equal(typeof health.active, 'string');
    assert.ok(health.providers.online);

    const probe = await page.evaluate(() => window.lingYuAPI.probeLLMProviders());
    assert.equal(probe.ok, true);
    assert.ok(probe.metrics.totalProbes >= 1);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyu-e2e-modify-'));
    await page.evaluate(async (root) => {
      await window.lingYuAPI.modifyCodebase({
        root,
        changes: [{ path: 'conflict.txt', content: 'current-change' }],
        options: { transactional: true }
      });
    }, tmpRoot);

    const conflictResult = await page.evaluate((payload) => window.lingYuAPI.modifyCodebase(payload), {
      root: tmpRoot,
      changes: [{
        path: 'conflict.txt',
        content: 'incoming-change',
        baseContent: 'same',
        expectedHash: sha1('same')
      }],
      options: { mergeStrategy: 'patch', transactional: true }
    });

    assert.equal(conflictResult.ok, false);
    assert.match(conflictResult.failed?.[0]?.reason || '', /patch merge conflict/);
  } finally {
    await app.close();
  }
});
