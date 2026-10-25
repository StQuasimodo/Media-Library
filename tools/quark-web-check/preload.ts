import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('quarkCheck', {
  action: (action: string, id?: string) => ipcRenderer.invoke('quark-check:action', action, id),
});
