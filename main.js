import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';

import { registerIpcHandlers } from './src/core/ipcHandlers.js';
import { LLMManager } from './src/agents/llmManager.js';

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    show: process.env.LINGYU_E2E !== '1',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(app.getAppPath(), 'src/index.html'));

  if (process.env.LINGYU_E2E === '1') {
    win.show();
  }
};

registerIpcHandlers({
  ipcMain,
  app,
  llmManager: new LLMManager(),
  dialog: {
    ...dialog,
    showMessageBox: async (opts) => {
      if (process.env.LINGYU_E2E === '1') {
        const e2eResponse = process.env.LINGYU_E2E_APPROVAL === '0' ? 0 : 1;
        return { response: e2eResponse };
      }
      return dialog.showMessageBox(opts);
    }
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
