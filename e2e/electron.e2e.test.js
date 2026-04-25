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
