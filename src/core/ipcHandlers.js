import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHmac, randomUUID } from 'node:crypto';

import { applyCodebaseChanges } from './applyCodebaseChanges.js';

const MEMORY_FILE = 'memory.json';
const ALERT_FAILED_QUEUE_FILE = 'alert-failed-queue.jsonl';
const ALERT_DELIVERY_JOURNAL_FILE = 'alert-delivery-journal.jsonl';
const ALERT_ACK_JOURNAL_FILE = 'alert-ack-journal.jsonl';
const DEFAULT_TENANT_ID = 'default';

const resolveSigningProfile = (payload = {}) => {
  const tenantId = String(payload.tenantId || DEFAULT_TENANT_ID);
  const tenantSecrets = payload.secretsByTenant?.[tenantId];
  const keyRing = tenantSecrets && typeof tenantSecrets === 'object' ? tenantSecrets : {};
  const keyIds = Object.keys(keyRing).filter((id) => typeof keyRing[id] === 'string' && keyRing[id]);
  const activeMap = payload.activeKeyIdByTenant && typeof payload.activeKeyIdByTenant === 'object'
    ? payload.activeKeyIdByTenant
    : {};

  const negotiatedVersions = Array.isArray(payload.signatureVersions)
    ? payload.signatureVersions.map((item) => String(item).trim()).filter(Boolean)
    : ['v2', 'v1'];
  const supportsV2 = negotiatedVersions.includes('v2');
  const supportsV1 = negotiatedVersions.includes('v1');

  const keyId = String(
    payload.keyId
      || activeMap[tenantId]
      || payload.activeKeyId
      || keyIds[0]
      || ''
  );
  const tenantSecret = keyId ? keyRing[keyId] : '';
  const legacySecret = typeof payload.secret === 'string' ? payload.secret : '';
  const secret = (typeof tenantSecret === 'string' && tenantSecret) || legacySecret;

  let signatureVersion = '';
  if (secret) {
    if (supportsV2 && keyId) {
      signatureVersion = 'v2';
    } else if (supportsV1) {
      signatureVersion = 'v1';
    } else if (supportsV2) {
      signatureVersion = 'v2';
    }
  }

  return {
    tenantId,
    keyId: signatureVersion === 'v2' ? keyId : '',
    secret,
    signatureVersion,
    negotiatedVersions: negotiatedVersions.length > 0 ? negotiatedVersions.join(',') : 'v2,v1'
  };
};

export const registerIpcHandlers = ({ ipcMain, app, dialog, llmManager = null, httpPost = fetch }) => {
  const getMemoryPath = () => path.join(app.getPath('userData'), MEMORY_FILE);
  const getAlertQueuePath = () => path.join(app.getPath('userData'), ALERT_FAILED_QUEUE_FILE);
  const getAlertDeliveryJournalPath = () => path.join(app.getPath('userData'), ALERT_DELIVERY_JOURNAL_FILE);
  const getAlertAckJournalPath = () => path.join(app.getPath('userData'), ALERT_ACK_JOURNAL_FILE);

  const appendJsonl = async (file, item) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(item)}\n`, 'utf8');
  };

  const readJsonl = async (file) => {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  const writeJsonl = async (file, items) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const content = items.map((item) => JSON.stringify(item)).join('\n');
    await fs.writeFile(file, content ? `${content}\n` : '', 'utf8');
  };

  const deliverWebhookAlert = async (payload = {}) => {
    const {
      url,
      event = 'unknown',
      data = {},
      token = '',
      maxRetries = 2,
      backoffMs = 300,
      requireAck = true
    } = payload;

    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return { ok: false, reason: 'invalid webhook url' };
    }

    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signingProfile = resolveSigningProfile(payload);
    const deliveryId = payload.deliveryId || randomUUID();

    const body = JSON.stringify({
      source: 'ling-yu',
      deliveryId,
      event,
      data,
      ts: new Date().toISOString(),
      nonce,
      signer: {
        tenantId: signingProfile.tenantId,
        keyId: signingProfile.keyId,
        versions: signingProfile.negotiatedVersions
      }
    });

    const signaturePayload = signingProfile.signatureVersion === 'v2'
      ? `${timestamp}\n${nonce}\n${body}`
      : body;
    const signature = signingProfile.secret && signingProfile.signatureVersion
      ? createHmac('sha256', signingProfile.secret).update(signaturePayload).digest('hex')
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
            ...(signature ? { 'x-lingyu-signature-version': signingProfile.signatureVersion } : {}),
            ...(signature ? { 'x-lingyu-signature-accept': signingProfile.negotiatedVersions } : {}),
            ...(signature ? { 'x-lingyu-signature': signature } : {}),
            ...(signature && signingProfile.keyId ? { 'x-lingyu-key-id': signingProfile.keyId } : {}),
            ...(signature ? { 'x-lingyu-tenant-id': signingProfile.tenantId } : {}),
            'x-lingyu-delivery-id': deliveryId,
            'x-lingyu-timestamp': timestamp,
            'x-lingyu-nonce': nonce
          },
          body
        });

        let ack = null;
        try {
          ack = await response.json();
        } catch {
          ack = null;
        }

        const ackToken = ack?.ackId || ack?.deliveryId;
        if (response.ok && (!requireAck || ackToken)) {
          const deliveredAt = new Date().toISOString();
          await appendJsonl(getAlertDeliveryJournalPath(), {
            deliveryId,
            ts: deliveredAt,
            url,
            event,
            tenantId: signingProfile.tenantId,
            keyId: signingProfile.keyId,
            status: 'delivered',
            attempt,
            ack: ack || null
          });
          if (ackToken) {
            await appendJsonl(getAlertAckJournalPath(), {
              ts: deliveredAt,
              deliveryId,
              ackId: ackToken,
              source: 'receiver',
              payload: ack
            });
          }
          return {
            ok: true,
            status: response.status,
            attempt,
            deliveryId,
            ack: ack || null
          };
        }

        if (response.ok && requireAck) {
          lastError = new Error('missing webhook ack');
        } else {
          lastError = new Error(`webhook status ${response.status}`);
        }
      } catch (error) {
        lastError = error;
      }

      if (attempt < retryCount) {
        const waitMs = initialBackoff * (2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    const failedItem = {
      ts: new Date().toISOString(),
      deliveryId,
      url,
      event,
      data,
      token,
      tenantId: signingProfile.tenantId,
      reason: lastError?.message || 'unknown webhook failure',
      retryCount: Math.max(0, Number(maxRetries) || 0),
      backoffMs: Math.max(50, Number(backoffMs) || 300),
      requireAck: Boolean(requireAck)
    };

    try {
      await appendJsonl(getAlertQueuePath(), failedItem);
    } catch {
      // ignore queue write failures, preserve original delivery error
    }

    return { ok: false, reason: lastError?.message || 'webhook delivery failed', deliveryId };
  };

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

  ipcMain.handle('alert:webhook', async (_evt, payload = {}) => deliverWebhookAlert(payload));

  ipcMain.handle('alert:webhook:ack', async (_evt, payload = {}) => {
    const deliveryId = String(payload.deliveryId || '').trim();
    const ackId = String(payload.ackId || '').trim();
    if (!deliveryId || !ackId) {
      return { ok: false, reason: 'deliveryId and ackId are required' };
    }

    const item = {
      ts: new Date().toISOString(),
      source: 'manual',
      deliveryId,
      ackId,
      note: payload.note || ''
    };
    await appendJsonl(getAlertAckJournalPath(), item);
    return { ok: true, ...item };
  });

  ipcMain.handle('alert:deadletter:list', async (_evt, payload = {}) => {
    const limit = Math.max(1, Math.min(200, Number(payload.limit) || 50));
    const all = await readJsonl(getAlertQueuePath());
    const filtered = all
      .filter((item) => (payload.event ? item.event === payload.event : true))
      .filter((item) => (payload.deliveryId ? item.deliveryId === payload.deliveryId : true));
    return {
      ok: true,
      total: filtered.length,
      items: filtered.slice(-limit).reverse()
    };
  });

  ipcMain.handle('alert:deadletter:replay', async (_evt, payload = {}) => {
    const limit = Math.max(1, Math.min(100, Number(payload.limit) || 20));
    const queue = await readJsonl(getAlertQueuePath());
    if (queue.length === 0) {
      return { ok: true, replayed: 0, succeeded: 0, failed: 0 };
    }

    const pending = queue.slice(0, Math.max(0, queue.length - limit));
    const replayBatch = queue.slice(-limit);
    const failedAfterReplay = [];
    let succeeded = 0;

    for (const item of replayBatch) {
      const result = await deliverWebhookAlert({
        ...item,
        maxRetries: Number(payload.maxRetries ?? item.retryCount ?? 1),
        backoffMs: Number(payload.backoffMs ?? item.backoffMs ?? 300),
        requireAck: payload.requireAck ?? item.requireAck ?? true
      });
      if (result.ok) {
        succeeded += 1;
      } else {
        failedAfterReplay.push(item);
      }
    }

    await writeJsonl(getAlertQueuePath(), [...pending, ...failedAfterReplay]);
    return {
      ok: true,
      replayed: replayBatch.length,
      succeeded,
      failed: failedAfterReplay.length
    };
  });
};
