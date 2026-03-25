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
  },
  
  // Webhook operations
  webhook: {
    // Generate HMAC-SHA256 signature
    generateSignature: (payload, secret) => ipcRenderer.invoke('webhook:generateSignature', payload, secret),
    
    // Verify webhook signature
    verifySignature: (payload, signature, config) => ipcRenderer.invoke('webhook:verifySignature', payload, signature, config),
    
    // Create webhook config
    createWebhookConfig: (url, secret) => ipcRenderer.invoke('webhook:createConfig', url, secret),
    
    // Get all webhooks
    getAllWebhooks: () => ipcRenderer.invoke('webhook:getAll'),
    
    // Get webhook by ID
    getWebhook: (id) => ipcRenderer.invoke('webhook:get', id),
    
    // Start secret rotation
    startRotation: (id, newSecret) => ipcRenderer.invoke('webhook:startRotation', id, newSecret),
    
    // Complete secret rotation
    completeRotation: (id) => ipcRenderer.invoke('webhook:completeRotation', id),
    
    // Cancel secret rotation
    cancelRotation: (id) => ipcRenderer.invoke('webhook:cancelRotation', id),
    
    // Delete webhook
    deleteWebhook: (id) => ipcRenderer.invoke('webhook:delete', id),
    
    // Generate new secret
    generateSecret: () => ipcRenderer.invoke('webhook:generateSecret'),
    
    // Validate secret format
    validateSecret: (secret) => ipcRenderer.invoke('webhook:validateSecret', secret),
  }
});