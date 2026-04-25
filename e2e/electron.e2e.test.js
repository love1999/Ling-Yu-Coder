import test from 'node:test';
import assert from 'node:assert/strict';

const hasPlaywright = async () => {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
};

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

    const approved = await page.evaluate(() => window.lingYuAPI.requestApproval('E2E approval'));
    assert.equal(approved, true);

    const health = await page.evaluate(() => window.lingYuAPI.getLLMHealth());
    assert.equal(health.ok, true);
    assert.equal(typeof health.active, 'string');
    assert.ok(health.providers.online);

    const probe = await page.evaluate(() => window.lingYuAPI.probeLLMProviders());
    assert.equal(probe.ok, true);
    assert.ok(probe.metrics.totalProbes >= 1);
  } finally {
    await app.close();
  }
});
