import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const MEMORY_FILE = 'memory.json';

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(app.getAppPath(), 'src/index.html'));
};

const getMemoryPath = () => path.join(app.getPath('userData'), MEMORY_FILE);
const textHash = (content) => createHash('sha1').update(content || '').digest('hex');

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
  const normalizedRoot = path.resolve(root || app.getPath('documents'));
  const applied = [];
  const failed = [];
  const backups = [];
  const transactional = Boolean(options.transactional);
  const dryRun = Boolean(options.dryRun);

  for (const change of changes) {
    const filePath = path.resolve(normalizedRoot, change.path);

    if (!filePath.startsWith(normalizedRoot)) {
      failed.push({ path: change.path, reason: '越界路径' });
      if (transactional) break;
      continue;
    }

    try {
      let existed = true;
      let content = null;
      try {
        content = await fs.readFile(filePath, 'utf8');
      } catch {
        existed = false;
      }

      if (change.expectedHash && textHash(content || '') !== change.expectedHash) {
        failed.push({ path: change.path, reason: '冲突: 文件已变更（hash 不匹配）' });
        if (transactional) break;
        continue;
      }

      backups.push({ path: filePath, existed, content });

      if (!dryRun) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, change.content, 'utf8');
      }
      applied.push(change.path);
    } catch (error) {
      failed.push({ path: change.path, reason: error.message });
      if (transactional) break;
    }
  }

  if (transactional && failed.length > 0 && !dryRun) {
    for (const backup of backups.reverse()) {
      try {
        if (backup.existed) {
          await fs.writeFile(backup.path, backup.content, 'utf8');
        } else {
          await fs.rm(backup.path, { force: true });
        }
      } catch {
        // ignore rollback errors to preserve original failure details
      }
    }
    return { ok: false, applied: [], failed, rolledBack: true, root: normalizedRoot };
  }

  return {
    ok: failed.length === 0,
    applied,
    failed,
    rolledBack: false,
    dryRun,
    root: normalizedRoot
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
