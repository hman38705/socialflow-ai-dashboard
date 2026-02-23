/**
 * Notification Preferences Types
 * Defines the structure for managing user notification settings
 */

export type NotificationType = 'payment' | 'transfer' | 'contract';
export type NotificationPriority = 'high' | 'medium' | 'low';

export interface NotificationPreference {
  type: NotificationType;
  enabled: boolean;
  priority: NotificationPriority;
  sound: boolean;
  vibration: boolean;
}

export interface QuietHoursConfig {
  enabled: boolean;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  allowHighPriority: boolean; // Allow high priority notifications during quiet hours
}

export interface DoNotDisturbMode {
  enabled: boolean;
  expiresAt?: number; // Unix timestamp, undefined means indefinite
  exceptions: NotificationType[]; // Types to allow during DND
}

export interface NotificationSettings {
  notifications: {
    payment: NotificationPreference;
    transfer: NotificationPreference;
    contract: NotificationPreference;
  };
  quietHours: QuietHoursConfig;
  doNotDisturb: DoNotDisturbMode;
  emailNotifications: boolean;
  pushNotifications: boolean;
  inAppNotifications: boolean;
}

// Default notification settings
export const defaultNotificationSettings: NotificationSettings = {
  notifications: {
    payment: {
      type: 'payment',
      enabled: true,
      priority: 'high',
      sound: true,
      vibration: true,
    },
    transfer: {
      type: 'transfer',
      enabled: true,
      priority: 'medium',
      sound: true,
      vibration: false,
    },
    contract: {
      type: 'contract',
      enabled: true,
      priority: 'low',
      sound: false,
      vibration: false,
    },
  },
  quietHours: {
    enabled: false,
    startTime: '22:00',
    endTime: '08:00',
    allowHighPriority: true,
  },
  doNotDisturb: {
    enabled: false,
    exceptions: [],
  },
  emailNotifications: true,
  pushNotifications: true,
  inAppNotifications: true,
};
