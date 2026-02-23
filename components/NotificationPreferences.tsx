import React, { useState, useEffect } from 'react';
import {
  NotificationSettings,
  NotificationType,
  NotificationPriority,
  defaultNotificationSettings,
} from '../types/notifications';

interface NotificationSettingsProps {
  onClose: () => void;
  onSave?: (settings: NotificationSettings) => void;
}

export const NotificationPreferences: React.FC<NotificationSettingsProps> = ({
  onClose,
  onSave,
}) => {
  const [settings, setSettings] = useState<NotificationSettings>(
    defaultNotificationSettings
  );
  const [activeTab, setActiveTab] = useState<
    'notifications' | 'quiet-hours' | 'dnd'
  >('notifications');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('notificationSettings');
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load notification settings');
      }
    }
  }, []);

  // Save settings to localStorage
  const handleSave = () => {
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
    onSave?.(settings);
  };

  const updateNotification = (
    type: NotificationType,
    field: string,
    value: any
  ) => {
    setSettings((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [type]: {
          ...prev.notifications[type],
          [field]: value,
        },
      },
    }));
  };

  const updateQuietHours = (field: string, value: any) => {
    setSettings((prev) => ({
      ...prev,
      quietHours: {
        ...prev.quietHours,
        [field]: value,
      },
    }));
  };

  const updateDND = (field: string, value: any) => {
    setSettings((prev) => ({
      ...prev,
      doNotDisturb: {
        ...prev.doNotDisturb,
        [field]: value,
      },
    }));
  };

  const toggleDNDException = (type: NotificationType) => {
    setSettings((prev) => {
      const exceptions = prev.doNotDisturb.exceptions.includes(type)
        ? prev.doNotDisturb.exceptions.filter((t) => t !== type)
        : [...prev.doNotDisturb.exceptions, type];
      return {
        ...prev,
        doNotDisturb: {
          ...prev.doNotDisturb,
          exceptions,
        },
      };
    });
  };

  const getPriorityColor = (priority: NotificationPriority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-500/20 text-red-400';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'low':
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  const Toggle = ({
    label,
    checked,
    onChange,
    description,
  }: {
    label: string;
    checked: boolean;
    onChange: (val: boolean) => void;
    description?: string;
  }) => (
    <div className="flex justify-between items-start bg-[#1A1D1F] p-4 rounded-lg">
      <div className="flex-1">
        <span className="text-white block">{label}</span>
        {description && <span className="text-gray-400 text-sm">{description}</span>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out flex-shrink-0 ml-4 ${
          checked ? 'bg-blue-600' : 'bg-gray-600'
        }`}
      >
        <div
          className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
            checked ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#0D0E10] rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#0D0E10] border-b border-gray-700 p-6 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white">Notification Preferences</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-700 px-6 flex gap-4">
          {(['notifications', 'quiet-hours', 'dnd'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-2 border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab === 'notifications' && 'Notification Types'}
              {tab === 'quiet-hours' && 'Quiet Hours'}
              {tab === 'dnd' && 'Do Not Disturb'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Notification Types Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">Notification Types</h3>
                <p className="text-sm text-gray-400">
                  Configure which notifications you want to receive and their settings
                </p>
              </div>

              {/* Global Notification Settings */}
              <div className="border-t border-gray-700 pt-6">
                <h4 className="text-white font-semibold mb-4">Global Settings</h4>
                <div className="space-y-3">
                  <Toggle
                    label="Email Notifications"
                    checked={settings.emailNotifications}
                    onChange={(val) =>
                      setSettings((prev) => ({
                        ...prev,
                        emailNotifications: val,
                      }))
                    }
                  />
                  <Toggle
                    label="Push Notifications"
                    checked={settings.pushNotifications}
                    onChange={(val) =>
                      setSettings((prev) => ({
                        ...prev,
                        pushNotifications: val,
                      }))
                    }
                  />
                  <Toggle
                    label="In-App Notifications"
                    checked={settings.inAppNotifications}
                    onChange={(val) =>
                      setSettings((prev) => ({
                        ...prev,
                        inAppNotifications: val,
                      }))
                    }
                  />
                </div>
              </div>

              {/* Per-Type Settings */}
              <div className="border-t border-gray-700 pt-6">
                <h4 className="text-white font-semibold mb-4">Notification Type Settings</h4>
                <div className="space-y-6">
                  {(['payment', 'transfer', 'contract'] as const).map((type) => (
                    <div
                      key={type}
                      className="bg-[#1A1D1F] p-4 rounded-lg border border-gray-700"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h5 className="text-white font-semibold capitalize">
                            {type} Notifications
                          </h5>
                          <p className="text-sm text-gray-400 mt-1">
                            Receive alerts for {type} transactions
                          </p>
                        </div>
                        <span
                          className={`text-xs font-semibold px-3 py-1 rounded-full ${getPriorityColor(
                            settings.notifications[type].priority
                          )}`}
                        >
                          {settings.notifications[type].priority.toUpperCase()}
                        </span>
                      </div>

                      <div className="space-y-3">
                        <Toggle
                          label="Enabled"
                          checked={settings.notifications[type].enabled}
                          onChange={(val) =>
                            updateNotification(type, 'enabled', val)
                          }
                        />

                        {settings.notifications[type].enabled && (
                          <>
                            <div className="flex justify-between items-center bg-[#0D0E10] p-3 rounded">
                              <label className="text-white text-sm">
                                Priority Level
                              </label>
                              <select
                                value={settings.notifications[type].priority}
                                onChange={(e) =>
                                  updateNotification(
                                    type,
                                    'priority',
                                    e.target.value as NotificationPriority
                                  )
                                }
                                className="bg-gray-700 text-white px-3 py-1 rounded text-sm"
                              >
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                              </select>
                            </div>

                            <Toggle
                              label="Sound"
                              checked={settings.notifications[type].sound}
                              onChange={(val) =>
                                updateNotification(type, 'sound', val)
                              }
                              description="Play sound when notification arrives"
                            />

                            <Toggle
                              label="Vibration"
                              checked={settings.notifications[type].vibration}
                              onChange={(val) =>
                                updateNotification(type, 'vibration', val)
                              }
                              description="Vibrate device when notification arrives"
                            />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quiet Hours Tab */}
          {activeTab === 'quiet-hours' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">Quiet Hours</h3>
                <p className="text-sm text-gray-400">
                  Set a time period when notifications are muted
                </p>
              </div>

              <div className="space-y-4">
                <Toggle
                  label="Enable Quiet Hours"
                  checked={settings.quietHours.enabled}
                  onChange={(val) => updateQuietHours('enabled', val)}
                  description="Mute non-critical notifications during specified hours"
                />

                {settings.quietHours.enabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4 bg-[#1A1D1F] p-4 rounded-lg">
                      <div>
                        <label className="block text-white text-sm font-semibold mb-2">
                          Start Time
                        </label>
                        <input
                          type="time"
                          value={settings.quietHours.startTime}
                          onChange={(e) => updateQuietHours('startTime', e.target.value)}
                          className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-white text-sm font-semibold mb-2">
                          End Time
                        </label>
                        <input
                          type="time"
                          value={settings.quietHours.endTime}
                          onChange={(e) => updateQuietHours('endTime', e.target.value)}
                          className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                        />
                      </div>
                    </div>

                    <Toggle
                      label="Allow High Priority During Quiet Hours"
                      checked={settings.quietHours.allowHighPriority}
                      onChange={(val) => updateQuietHours('allowHighPriority', val)}
                      description="High priority notifications will still break through"
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Do Not Disturb Tab */}
          {activeTab === 'dnd' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white">Do Not Disturb</h3>
                <p className="text-sm text-gray-400">
                  Temporarily disable all notifications with optional exceptions
                </p>
              </div>

              <div className="space-y-4">
                <Toggle
                  label="Enable Do Not Disturb"
                  checked={settings.doNotDisturb.enabled}
                  onChange={(val) => updateDND('enabled', val)}
                  description="Disable all notifications except exceptions"
                />

                {settings.doNotDisturb.enabled && (
                  <>
                    <div className="bg-[#1A1D1F] p-4 rounded-lg">
                      <label className="block text-white text-sm font-semibold mb-2">
                        Duration
                      </label>
                      <select
                        onClick={(e) => {
                          const select = e.currentTarget as HTMLSelectElement;
                          if (select.value === '1h') {
                            updateDND('expiresAt', Date.now() + 60 * 60 * 1000);
                          } else if (select.value === '2h') {
                            updateDND('expiresAt', Date.now() + 2 * 60 * 60 * 1000);
                          } else if (select.value === '8h') {
                            updateDND('expiresAt', Date.now() + 8 * 60 * 60 * 1000);
                          } else if (select.value === 'indefinite') {
                            updateDND('expiresAt', undefined);
                          }
                        }}
                        className="w-full bg-gray-700 text-white px-3 py-2 rounded text-sm"
                      >
                        <option value="1h">1 Hour</option>
                        <option value="2h">2 Hours</option>
                        <option value="8h">8 Hours</option>
                        <option value="indefinite">Indefinite</option>
                      </select>
                    </div>

                    <div className="border-t border-gray-700 pt-4">
                      <h4 className="text-white font-semibold mb-4">Allow Exceptions</h4>
                      <p className="text-sm text-gray-400 mb-4">
                        Select notification types to allow during DND
                      </p>
                      <div className="space-y-2">
                        {(['payment', 'transfer', 'contract'] as const).map((type) => (
                          <button
                            key={type}
                            onClick={() => toggleDNDException(type)}
                            className={`w-full text-left p-3 rounded-lg transition-colors capitalize ${
                              settings.doNotDisturb.exceptions.includes(type)
                                ? 'bg-blue-600 text-white'
                                : 'bg-[#0D0E10] text-gray-400 hover:bg-gray-800'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={settings.doNotDisturb.exceptions.includes(
                                  type
                                )}
                                onChange={() => {}}
                                className="w-4 h-4 cursor-pointer"
                              />
                              {type} Notifications
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#0D0E10] border-t border-gray-700 p-6 flex justify-end gap-3">
          {saveSuccess && (
            <span className="text-green-400 text-sm font-medium flex items-center gap-2">
              ✓ Settings saved
            </span>
          )}
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-semibold"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
