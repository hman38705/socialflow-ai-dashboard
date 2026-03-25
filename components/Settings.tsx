import React, { useState, useEffect } from 'react';
import { ViewProps, WebhookConfig } from '../types';

// Browser fallback crypto implementation using SubtleCrypto
const browserCrypto = {
  generateSecret: (): string => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  
  generateHmac: async (secret: string, payload: string): Promise<string> => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  
  isValidSecret: (secret: string): boolean => {
    return /^[a-f0-9]{32,}$/i.test(secret);
  },
  
  randomUUID: (): string => {
    return crypto.randomUUID ? crypto.randomUUID() : 
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
  }
};

// Type declaration for the exposed Electron API
declare global {
  interface Window {
    electronAPI?: {
      webhook?: {
        generateSignature: (payload: string, secret: string) => Promise<string>;
        verifySignature: (payload: string, signature: string, config: WebhookConfig) => Promise<{ valid: boolean; secretUsed: string | null; error?: string }>;
        createWebhookConfig: (url: string, secret: string) => Promise<WebhookConfig>;
        getAllWebhooks: () => Promise<WebhookConfig[]>;
        getWebhook: (id: string) => Promise<WebhookConfig | undefined>;
        startRotation: (id: string, newSecret: string) => Promise<WebhookConfig | null>;
        completeRotation: (id: string) => Promise<WebhookConfig | null>;
        cancelRotation: (id: string) => Promise<WebhookConfig | null>;
        deleteWebhook: (id: string) => Promise<boolean>;
        generateSecret: () => Promise<string>;
        validateSecret: (secret: string) => Promise<boolean>;
      };
    };
  }
}

export const Settings: React.FC<ViewProps> = ({ onNavigate }) => {
  // State for toggles (all enabled by default)
  const [darkMode, setDarkMode] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);

  // Webhook state
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [showRotationModal, setShowRotationModal] = useState<string | null>(null);
  const [rotationSecret, setRotationSecret] = useState('');
  const [testSignature, setTestSignature] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check if running in Electron
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.webhook;

  // Load webhooks on mount
  useEffect(() => {
    if (isElectron) {
      loadWebhooks();
    } else {
      setIsLoading(false);
    }
  }, [isElectron]);

  const loadWebhooks = async () => {
    try {
      const data = await window.electronAPI?.webhook?.getAllWebhooks();
      setWebhooks(data || []);
    } catch (error) {
      console.error('Failed to load webhooks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (val: boolean) => void }) => (
    <div className="flex justify-between items-center bg-[#1A1D1F] p-4 rounded-lg">
      <span className="text-white">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${checked ? 'bg-blue-600' : 'bg-gray-600'}`}
      >
        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  );

  // Generate a test payload and signature for the webhook
  const generateTestSignature = async (config: WebhookConfig) => {
    const testPayload = JSON.stringify({ event: 'test', timestamp: Date.now() });
    try {
      const signature = await window.electronAPI?.webhook?.generateSignature(testPayload, config.secret);
      setTestSignature(signature || '');
    } catch (error) {
      console.error('Failed to generate signature:', error);
    }
  };

  const handleCreateWebhook = async () => {
    if (!newWebhookUrl || !newSecret) {
      alert('Please provide both webhook URL and secret');
      return;
    }

    const isValid = await window.electronAPI?.webhook?.validateSecret(newSecret);
    if (!isValid) {
      alert('Secret must be at least 32 hex characters (256 bits)');
      return;
    }

    try {
      const config = await window.electronAPI?.webhook?.createWebhookConfig(newWebhookUrl, newSecret);
      if (config) {
        setWebhooks([...webhooks, config]);
        setNewWebhookUrl('');
        setNewSecret('');
      }
    } catch (error) {
      console.error('Failed to create webhook:', error);
    }
  };

  const handleStartRotation = async (id: string) => {
    const isValid = await window.electronAPI?.webhook?.validateSecret(rotationSecret);
    if (!isValid) {
      alert('New secret must be at least 32 hex characters (256 bits)');
      return;
    }

    try {
      const config = await window.electronAPI?.webhook?.startRotation(id, rotationSecret);
      if (config) {
        setWebhooks(webhooks.map(w => w.id === id ? config : w));
        setShowRotationModal(null);
        setRotationSecret('');
      }
    } catch (error) {
      console.error('Failed to start rotation:', error);
    }
  };

  const handleCompleteRotation = async (id: string) => {
    try {
      const config = await window.electronAPI?.webhook?.completeRotation(id);
      if (config) {
        setWebhooks(webhooks.map(w => w.id === id ? config : w));
      }
    } catch (error) {
      console.error('Failed to complete rotation:', error);
    }
  };

  const handleCancelRotation = async (id: string) => {
    try {
      const config = await window.electronAPI?.webhook?.cancelRotation(id);
      if (config) {
        setWebhooks(webhooks.map(w => w.id === id ? config : w));
      }
    } catch (error) {
      console.error('Failed to cancel rotation:', error);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (confirm('Are you sure you want to delete this webhook?')) {
      try {
        await window.electronAPI?.webhook?.deleteWebhook(id);
        setWebhooks(webhooks.filter(w => w.id !== id));
      } catch (error) {
        console.error('Failed to delete webhook:', error);
      }
    }
  };

  const handleGenerateSecret = async () => {
    try {
      const secret = await window.electronAPI?.webhook?.generateSecret();
      setNewSecret(secret || '');
    } catch (error) {
      console.error('Failed to generate secret:', error);
    }
  };

  const handleGenerateRotationSecret = async () => {
    try {
      const secret = await window.electronAPI?.webhook?.generateSecret();
      setRotationSecret(secret || '');
    } catch (error) {
      console.error('Failed to generate secret:', error);
    }
  };

  // Fallback for non-Electron environment (browser)
  const handleCreateWebhookFallback = () => {
    if (!newWebhookUrl || !newSecret) {
      alert('Please provide both webhook URL and secret');
      return;
    }

    if (!/^[a-f0-9]{32,}$/i.test(newSecret)) {
      alert('Secret must be at least 32 hex characters (256 bits)');
      return;
    }

    const config: WebhookConfig = {
      id: crypto.randomUUID(),
      url: newWebhookUrl,
      secret: newSecret,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      rotationInProgress: false,
    };

    setWebhooks([...webhooks, config]);
    setNewWebhookUrl('');
    setNewSecret('');
  };

  const handleGenerateSecretFallback = () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const secret = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    setNewSecret(secret);
  };

  const handleGenerateRotationSecretFallback = () => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    const secret = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    setRotationSecret(secret);
  };

  const handleStartRotationFallback = (id: string) => {
    if (!/^[a-f0-9]{32,}$/i.test(rotationSecret)) {
      alert('New secret must be at least 32 hex characters (256 bits)');
      return;
    }

    setWebhooks(webhooks.map(w => {
      if (w.id === id) {
        return {
          ...w,
          oldSecret: w.secret,
          secret: rotationSecret,
          rotationInProgress: true,
          rotationStartedAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return w;
    }));
    setShowRotationModal(null);
    setRotationSecret('');
  };

  const handleCompleteRotationFallback = (id: string) => {
    setWebhooks(webhooks.map(w => {
      if (w.id === id) {
        return {
          ...w,
          oldSecret: undefined,
          rotationInProgress: false,
          rotationStartedAt: undefined,
          updatedAt: new Date(),
        };
      }
      return w;
    }));
  };

  const handleCancelRotationFallback = (id: string) => {
    setWebhooks(webhooks.map(w => {
      if (w.id === id && w.oldSecret) {
        return {
          ...w,
          secret: w.oldSecret,
          oldSecret: undefined,
          rotationInProgress: false,
          rotationStartedAt: undefined,
          updatedAt: new Date(),
        };
      }
      return w;
    }));
  };

  const handleDeleteWebhookFallback = (id: string) => {
    if (confirm('Are you sure you want to delete this webhook?')) {
      setWebhooks(webhooks.filter(w => w.id !== id));
    }
  };

  const generateTestSignatureFallback = (config: WebhookConfig) => {
    const testPayload = JSON.stringify({ event: 'test', timestamp: Date.now() });
    const signature = crypto.createHmac('sha256', config.secret).update(testPayload, 'utf8').digest('hex');
    setTestSignature(signature);
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      <div className="space-y-8">
        {/* General Options Section */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">General Options</h3>
          <div className="space-y-3">
            <Toggle label="Dark Mode" checked={darkMode} onChange={setDarkMode} />
            <Toggle label="Email Notifications" checked={emailNotifications} onChange={setEmailNotifications} />
            <Toggle label="Public Profile" checked={publicProfile} onChange={setPublicProfile} />
            <Toggle label="Auto-Update" checked={autoUpdate} onChange={setAutoUpdate} />
          </div>
        </div>

        {/* Account Section */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Account</h3>
          <div className="space-y-3">
            <button className="w-full text-left bg-[#1A1D1F] hover:bg-[#2A2D2F] text-white py-3 px-4 rounded-lg flex justify-between items-center transition-colors">
              <span>Profile Settings</span>
              <span className="material-symbols-outlined">arrow_forward_ios</span>
            </button>
            <button className="w-full text-left bg-[#1A1D1F] hover:bg-[#2A2D2F] text-white py-3 px-4 rounded-lg flex justify-between items-center transition-colors">
              <span>Notification Preferences</span>
              <span className="material-symbols-outlined">arrow_forward_ios</span>
            </button>
            <button className="w-full text-left bg-[#1A1D1F] hover:bg-[#2A2D2F] text-white py-3 px-4 rounded-lg flex justify-between items-center transition-colors">
              <span>Appearance</span>
              <span className="material-symbols-outlined">arrow_forward_ios</span>
            </button>
            <button className="w-full text-left bg-[#1A1D1F] hover:bg-[#2A2D2F] text-white py-3 px-4 rounded-lg flex justify-between items-center transition-colors">
              <span>Integrations</span>
              <span className="material-symbols-outlined">arrow_forward_ios</span>
            </button>
            <button className="w-full text-left bg-[#1A1D1F] hover:bg-[#2A2D2F] text-white py-3 px-4 rounded-lg flex justify-between items-center transition-colors">
              <span>Billing & Subscription</span>
              <span className="material-symbols-outlined">arrow_forward_ios</span>
            </button>
          </div>
        </div>

        {/* Webhook Integration Section */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Webhook Integration</h3>
          <div className="space-y-4">
            {/* Create new webhook */}
            <div className="bg-[#1A1D1F] p-4 rounded-lg space-y-3">
              <h4 className="text-white font-medium">Add New Webhook</h4>
              <input
                type="url"
                placeholder="Webhook URL (e.g., https://example.com/webhook)"
                value={newWebhookUrl}
                onChange={(e) => setNewWebhookUrl(e.target.value)}
                className="w-full bg-[#2A2D2F] text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Signing Secret (min 32 hex chars)"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  className="flex-1 bg-[#2A2D2F] text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
                />
                <button
                  onClick={isElectron ? handleGenerateSecret : handleGenerateSecretFallback}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Generate
                </button>
              </div>
              <button
                onClick={isElectron ? handleCreateWebhook : handleCreateWebhookFallback}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg transition-colors font-medium"
              >
                Create Webhook
              </button>
            </div>

            {/* Existing webhooks */}
            {isLoading ? (
              <p className="text-gray-500 text-center py-4">Loading webhooks...</p>
            ) : webhooks.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No webhooks configured yet.</p>
            ) : (
              webhooks.map((webhook) => (
                <div key={webhook.id} className="bg-[#1A1D1F] p-4 rounded-lg space-y-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-white font-medium">{webhook.url}</h4>
                      <p className="text-gray-400 text-sm">
                        Created: {new Date(webhook.createdAt).toLocaleDateString()} | 
                        Status: {webhook.isActive ? 'Active' : 'Inactive'}
                        {webhook.rotationInProgress && ' | 🔄 Rotation in progress'}
                      </p>
                    </div>
                    <button
                      onClick={isElectron ? () => handleDeleteWebhook(webhook.id) : () => handleDeleteWebhookFallback(webhook.id)}
                      className="text-red-500 hover:text-red-400"
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>

                  {/* Secret display */}
                  <div className="bg-[#2A2D2F] p-3 rounded-lg">
                    <p className="text-gray-400 text-sm mb-1">Current Secret:</p>
                    <code className="text-green-400 text-xs font-mono break-all">{webhook.secret}</code>
                    {webhook.oldSecret && (
                      <div className="mt-2 pt-2 border-t border-gray-700">
                        <p className="text-gray-400 text-sm mb-1">Old Secret (for rotation):</p>
                        <code className="text-yellow-400 text-xs font-mono break-all">{webhook.oldSecret}</code>
                      </div>
                    )}
                  </div>

                  {/* Rotation controls */}
                  <div className="flex gap-2 flex-wrap">
                    {!webhook.rotationInProgress ? (
                      <button
                        onClick={() => setShowRotationModal(webhook.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors text-sm"
                      >
                        Start Secret Rotation
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={isElectron ? () => handleCompleteRotation(webhook.id) : () => handleCompleteRotationFallback(webhook.id)}
                          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors text-sm"
                        >
                          Complete Rotation
                        </button>
                        <button
                          onClick={isElectron ? () => handleCancelRotation(webhook.id) : () => handleCancelRotationFallback(webhook.id)}
                          className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg transition-colors text-sm"
                        >
                          Cancel Rotation
                        </button>
                      </>
                    )}
                  </div>

                  {/* Test signature section */}
                  <div className="border-t border-gray-700 pt-3 mt-3">
                    <p className="text-gray-400 text-sm mb-2">Test Signature:</p>
                    <button
                      onClick={() => isElectron ? generateTestSignature(webhook) : generateTestSignatureFallback(webhook)}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Generate Test Signature
                    </button>
                    {testSignature && (
                      <div className="mt-2 bg-[#2A2D2F] p-2 rounded">
                        <code className="text-purple-400 text-xs font-mono break-all">{testSignature}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Rotation Modal */}
      {showRotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-[#1A1D1F] p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-white mb-4">Rotate Webhook Secret</h3>
            <p className="text-gray-400 mb-4">
              Enter a new secret. The old secret will remain valid during the rotation period,
              ensuring zero downtime for your integrations.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="New Signing Secret"
                value={rotationSecret}
                onChange={(e) => setRotationSecret(e.target.value)}
                className="w-full bg-[#2A2D2F] text-white px-4 py-2 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none font-mono text-sm"
              />
              <button
                onClick={isElectron ? handleGenerateRotationSecret : handleGenerateRotationSecretFallback}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white py-2 rounded-lg transition-colors text-sm"
              >
                Generate New Secret
              </button>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={isElectron ? () => handleStartRotation(showRotationModal) : () => handleStartRotationFallback(showRotationModal)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors"
              >
                Start Rotation
              </button>
              <button
                onClick={() => {
                  setShowRotationModal(null);
                  setRotationSecret('');
                }}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
