const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const crypto = require('crypto');

// In-memory storage for webhook configurations (in production, use a database)
const webhookConfigs = new Map();

/**
 * Generate a HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify webhook signature using current or old secret
 */
function verifySignature(payload, signature, config) {
  try {
    if (!signature) {
      return { valid: false, secretUsed: null, error: 'Missing signature' };
    }

    // Try current secret first
    const currentSignature = generateSignature(payload, config.secret);
    if (timingSafeEqual(signature, currentSignature)) {
      return { valid: true, secretUsed: 'current' };
    }

    // Try old secret if rotation is in progress
    if (config.rotationInProgress && config.oldSecret) {
      const oldSignature = generateSignature(payload, config.oldSecret);
      if (timingSafeEqual(signature, oldSignature)) {
        return { valid: true, secretUsed: 'old' };
      }
    }

    return { valid: false, secretUsed: null, error: 'Invalid signature' };
  } catch (error) {
    return { 
      valid: false, 
      secretUsed: null, 
      error: error.message || 'Verification failed' 
    };
  }
}

/**
 * Generate a new secret for rotation
 */
function generateNewSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate secret format
 */
function isValidSecret(secret) {
  return /^[a-f0-9]{32,}$/i.test(secret);
}

// Register IPC handlers for webhook operations
function registerWebhookHandlers() {
  ipcMain.handle('webhook:generateSignature', (event, payload, secret) => {
    return generateSignature(payload, secret);
  });

  ipcMain.handle('webhook:verifySignature', (event, payload, signature, config) => {
    return verifySignature(payload, signature, config);
  });

  ipcMain.handle('webhook:createConfig', (event, url, secret) => {
    const config = {
      id: crypto.randomUUID(),
      url,
      secret,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rotationInProgress: false,
    };
    webhookConfigs.set(config.id, config);
    return config;
  });

  ipcMain.handle('webhook:getAll', () => {
    return Array.from(webhookConfigs.values());
  });

  ipcMain.handle('webhook:get', (event, id) => {
    return webhookConfigs.get(id);
  });

  ipcMain.handle('webhook:startRotation', (event, id, newSecret) => {
    const config = webhookConfigs.get(id);
    if (!config) return null;

    config.oldSecret = config.secret;
    config.secret = newSecret;
    config.rotationInProgress = true;
    config.rotationStartedAt = new Date().toISOString();
    config.updatedAt = new Date().toISOString();
    
    webhookConfigs.set(id, config);
    return config;
  });

  ipcMain.handle('webhook:completeRotation', (event, id) => {
    const config = webhookConfigs.get(id);
    if (!config) return null;

    config.oldSecret = undefined;
    config.rotationInProgress = false;
    config.rotationStartedAt = undefined;
    config.updatedAt = new Date().toISOString();
    
    webhookConfigs.set(id, config);
    return config;
  });

  ipcMain.handle('webhook:cancelRotation', (event, id) => {
    const config = webhookConfigs.get(id);
    if (!config || !config.oldSecret) return null;

    config.secret = config.oldSecret;
    config.oldSecret = undefined;
    config.rotationInProgress = false;
    config.rotationStartedAt = undefined;
    config.updatedAt = new Date().toISOString();
    
    webhookConfigs.set(id, config);
    return config;
  });

  ipcMain.handle('webhook:delete', (event, id) => {
    return webhookConfigs.delete(id);
  });

  ipcMain.handle('webhook:generateSecret', () => {
    return generateNewSecret();
  });

  ipcMain.handle('webhook:validateSecret', (event, secret) => {
    return isValidSecret(secret);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0d0f11',
    titleBarStyle: 'hidden', // Frameless window
    titleBarOverlay: {
      color: '#0d0f11',
      symbolColor: '#ffffff',
      height: 40
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Register webhook IPC handlers
  registerWebhookHandlers();

  // In development, load from Vite dev server
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools(); // Uncomment to debug
  } else {
    // In production, load the built html
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});