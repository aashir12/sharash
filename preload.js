const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ShareMouse", {
  getState: () => ipcRenderer.invoke("app:getState"),
  startHost: (port) => ipcRenderer.invoke("host:start", { port }),
  stopHost: () => ipcRenderer.invoke("host:stop"),
  connectToHost: (host, port) => ipcRenderer.invoke("client:connect", { host, port }),
  disconnect: () => ipcRenderer.invoke("client:disconnect"),
  setSharing: (opts) => ipcRenderer.invoke("app:setSharing", opts),
  getLayout: () => ipcRenderer.invoke("layout:get"),
  saveLayout: (layout) => ipcRenderer.invoke("layout:save", { layout }),
  moveDevice: (id, x, y) => ipcRenderer.invoke("layout:moveDevice", { id, x, y }),
  on: (channel, cb) => {
    const listener = (_evt, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});

