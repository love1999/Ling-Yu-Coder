import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { applyCodebaseChanges } from './src/core/applyCodebaseChanges.js';

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
