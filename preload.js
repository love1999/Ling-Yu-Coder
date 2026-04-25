import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lingYuAPI', {
  inspectEnvironment: () => ipcRenderer.invoke('environment:inspect'),
  loadMemory: () => ipcRenderer.invoke('memory:load'),
  saveMemory: (data) => ipcRenderer.invoke('memory:save', data),
  runSnippet: (code) => ipcRenderer.invoke('runtime:run', code),
  requestApproval: (message) => ipcRenderer.invoke('approval:confirm', message),
  modifyCodebase: (payload) => ipcRenderer.invoke('codebase:modify', payload),
  getLLMHealth: () => ipcRenderer.invoke('llm:health'),
  probeLLMProviders: () => ipcRenderer.invoke('llm:probe'),
  sendWebhookAlert: (payload) => ipcRenderer.invoke('alert:webhook', payload),
  ackWebhookAlert: (payload) => ipcRenderer.invoke('alert:webhook:ack', payload),
  listWebhookDeadletters: (payload) => ipcRenderer.invoke('alert:deadletter:list', payload),
  replayWebhookDeadletters: (payload) => ipcRenderer.invoke('alert:deadletter:replay', payload)
});
