import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';

import { applyCodebaseChanges } from './applyCodebaseChanges.js';

const MEMORY_FILE = 'memory.json';
const ALERT_FAILED_QUEUE_FILE = 'alert-failed-queue.jsonl';

export const registerIpcHandlers = ({ ipcMain, app, dialog, llmManager = null, httpPost = fetch }) => {
  const getMemoryPath = () => path.join(app.getPath('userData'), MEMORY_FILE);
  const getAlertQueuePath = () => path.join(app.getPath('userData'), ALERT_FAILED_QUEUE_FILE);

  ipcMain.handle('environment:inspect', () => ({
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    appVersion: app.getVersion()
  }));

  ipcMain.handle('memory:load', async () => {
    const file = getMemoryPath();
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { notes: [], decisions: [], contexts: [] };
    }
  });

  ipcMain.handle('memory:save', async (_evt, data) => {
    const file = getMemoryPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  });

  ipcMain.handle('runtime:run', async (_evt, code) => {
    const logs = [];
    const sandbox = {
      console: {
        log: (...args) => logs.push(args.map(String).join(' '))
      }
    };
    const context = vm.createContext(sandbox);
    try {
      const script = new vm.Script(code);
      script.runInContext(context, { timeout: 1000 });
      return { ok: true, logs };
    } catch (error) {
      return { ok: false, logs, error: error.message };
    }
  });

  ipcMain.handle('approval:confirm', async (_evt, message) => {
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: ['拒绝', '批准'],
      defaultId: 1,
      cancelId: 0,
      title: 'Approval Gate',
      message
    });
    return result.response === 1;
  });

  ipcMain.handle('codebase:modify', async (_evt, { root, changes, options = {} }) => {
    const targetRoot = root || app.getPath('documents');
    return applyCodebaseChanges({ root: targetRoot, changes, options });
  });

  ipcMain.handle('llm:health', async () => {
    if (!llmManager) {
      return {
        ok: false,
        reason: 'llm manager not configured'
      };
    }

    return {
      ok: true,
      active: llmManager.active,
      providers: llmManager.listProviders(),
      metrics: llmManager.getHealthMetrics()
    };
  });

  ipcMain.handle('llm:probe', async () => {
    if (!llmManager) {
      return {
        ok: false,
        reason: 'llm manager not configured'
      };
    }

    const report = await llmManager.probeAllProviders();
    return {
      ok: true,
      active: llmManager.active,
      ...report
    };
  });

  ipcMain.handle('alert:webhook', async (_evt, payload = {}) => {
    const {
      url,
      event = 'unknown',
      data = {},
      token = '',
      secret = '',
      maxRetries = 2,
      backoffMs = 300
    } = payload;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return { ok: false, reason: 'invalid webhook url' };
    }

    const body = JSON.stringify({
      source: 'ling-yu',
      event,
      data,
      ts: new Date().toISOString()
    });

    const signature = secret
      ? createHmac('sha256', secret).update(body).digest('hex')
      : '';

    let lastError = null;
    const retryCount = Math.max(0, Number(maxRetries) || 0);
    const initialBackoff = Math.max(50, Number(backoffMs) || 300);

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await httpPost(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'x-lingyu-token': token } : {}),
            ...(signature ? { 'x-lingyu-signature-version': 'v1' } : {}),
            ...(signature ? { 'x-lingyu-signature': signature } : {})
          },
          body
        });

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            attempt
          };
        }

        lastError = new Error(`webhook status ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      if (attempt < retryCount) {
        const waitMs = initialBackoff * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    try {
      const queuePath = getAlertQueuePath();
      await fs.mkdir(path.dirname(queuePath), { recursive: true });
      const queueItem = JSON.stringify({
        ts: new Date().toISOString(),
        url,
        event,
        data,
        reason: lastError?.message || 'unknown webhook failure'
      });
      await fs.appendFile(queuePath, `${queueItem}\n`, 'utf8');
    } catch {
      // ignore queue write failures, preserve original delivery error
    }

    return { ok: false, reason: lastError?.message || 'webhook delivery failed' };
  });
};
