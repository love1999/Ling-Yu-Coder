import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';

import { registerIpcHandlers } from './src/core/ipcHandlers.js';

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
  dialog: {
    ...dialog,
    showMessageBox: async (opts) => {
      if (process.env.LINGYU_E2E === '1') {
        return { response: 1 };
      }
      return dialog.showMessageBox(opts);
    }
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
