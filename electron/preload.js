const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  sendMessage: (channel, data) => {
    // whitelist channels
    let validChannels = ["toMain"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }
});