import React, { useState } from 'react';
import { ViewProps } from '../types';

export const Settings: React.FC<ViewProps> = () => {
  // State for toggles (all enabled by default)
  const [darkMode, setDarkMode] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);

  // network & security
  const [network, setNetwork] = useState<'mainnet' | 'testnet' | 'custom'>('mainnet');
  const [twoFactor, setTwoFactor] = useState(false);
  const [autoLock, setAutoLock] = useState(false);

  // gas fee
  const [feePreference, setFeePreference] = useState<'low' | 'medium' | 'high'>('medium');

  // analytics storage settings
  const [storageFrequency, setStorageFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [estimatedCost, setEstimatedCost] = useState<string>('0.00');
  const [autoStorage, setAutoStorage] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

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

  // compute estimated cost when frequency changes
  React.useEffect(() => {
    const costMap: Record<string, number> = { daily: 0.1, weekly: 0.5, monthly: 1 };
    setEstimatedCost(costMap[storageFrequency].toFixed(2));
  }, [storageFrequency]);

  const handleManualStorage = () => {
    setHistory((prev) => [...prev, `Stored on ${new Date().toLocaleDateString()}`]);
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

        {/* Network Configuration */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Network Configuration</h3>
          <label className="block text-white mb-2" htmlFor="network-select">
            Select Network
            <select
              id="network-select"
              data-testid="network-select"
              className="w-full mt-1 p-2 bg-[#1A1D1F] text-white rounded-lg"
              value={network}
              onChange={(e) => setNetwork(e.target.value as any)}
            >
              <option value="mainnet">Mainnet</option>
              <option value="testnet">Testnet</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>

        {/* Security Section */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Security</h3>
          <div className="space-y-3">
            <Toggle label="Two-Factor Authentication" checked={twoFactor} onChange={setTwoFactor} />
            <Toggle label="Auto-Lock on Inactivity" checked={autoLock} onChange={setAutoLock} />
          </div>
        </div>

        {/* Gas Fee Preferences */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Gas Fee Preferences</h3>
          <div className="space-y-2 text-white">
            <label className="flex items-center" htmlFor="fee-low">
              <input
                id="fee-low"
                data-testid="fee-low"
                type="radio"
                name="fee"
                value="low"
                checked={feePreference === 'low'}
                onChange={() => setFeePreference('low')}
                className="mr-2"
              />
              Low
            </label>
            <label className="flex items-center" htmlFor="fee-medium">
              <input
                id="fee-medium"
                data-testid="fee-medium"
                type="radio"
                name="fee"
                value="medium"
                checked={feePreference === 'medium'}
                onChange={() => setFeePreference('medium')}
                className="mr-2"
              />
              Medium
            </label>
            <label className="flex items-center" htmlFor="fee-high">
              <input
                id="fee-high"
                data-testid="fee-high"
                type="radio"
                name="fee"
                value="high"
                checked={feePreference === 'high'}
                onChange={() => setFeePreference('high')}
                className="mr-2"
              />
              High
            </label>
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

        {/* Analytics Storage Settings */}
        <div>
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Analytics Storage</h3>
          <div className="space-y-3">
            <label className="block text-white" htmlFor="frequency-select">
              Storage Frequency
              <select
                id="frequency-select"
                data-testid="frequency-select"
                value={storageFrequency}
                onChange={(e) => setStorageFrequency(e.target.value as any)}
                className="mt-1 w-full p-2 bg-[#1A1D1F] text-white rounded-lg"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <div className="text-white">
              Estimated cost: <span data-testid="estimated-cost">${estimatedCost}</span>
            </div>
            <Toggle label="Automatic On-Chain Storage" checked={autoStorage} onChange={setAutoStorage} />
            <button
              data-testid="manual-store-button"
              onClick={handleManualStorage}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Store Now
            </button>
            <div className="text-white">
              <h4 className="font-semibold">History</h4>
              {history.length === 0 ? (
                <p data-testid="history-empty" className="text-gray-400">No on-chain submissions yet.</p>
              ) : (
                <ul data-testid="history-list" className="list-disc list-inside">
                  {history.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};