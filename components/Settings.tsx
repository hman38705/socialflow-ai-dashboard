import React, { useState } from 'react';
import { ViewProps } from '../types';

export const Settings: React.FC<ViewProps> = ({ onNavigate }) => {
  // State for toggles (all enabled by default)
  const [darkMode, setDarkMode] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);

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
      </div>
    </div>
  );
};