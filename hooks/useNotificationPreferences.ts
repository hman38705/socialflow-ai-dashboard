import { useState, useCallback, useEffect } from 'react';
import { notificationService } from '../services/notificationService';
import {
  NotificationSettings,
  NotificationType,
  defaultNotificationSettings,
} from '../types/notifications';

/**
 * Custom hook for managing notification preferences in React components
 */
export const useNotificationPreferences = () => {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem('notificationSettings');
      return saved ? JSON.parse(saved) : defaultNotificationSettings;
    } catch {
      return defaultNotificationSettings;
    }
  });

  const [isDNDActive, setIsDNDActive] = useState(false);
  const [dndTimeRemaining, setDndTimeRemaining] = useState<number | null>(null);

  // Update DND status periodically
  useEffect(() => {
    const checkDND = () => {
      setIsDNDActive(notificationService.isDNDActive());
      setDndTimeRemaining(notificationService.getDNDTimeRemaining());
    };

    checkDND();
    const interval = setInterval(checkDND, 1000);
    return () => clearInterval(interval);
  }, []);

  const updateSettings = useCallback((newSettings: NotificationSettings) => {
    setSettings(newSettings);
    notificationService.updateSettings(newSettings);
  }, []);

  const shouldShowNotification = useCallback(
    (type: NotificationType) => {
      return notificationService.shouldShowNotification(type);
    },
    []
  );

  const shouldPlaySound = useCallback((type: NotificationType) => {
    return notificationService.shouldPlaySound(type);
  }, []);

  const shouldVibrate = useCallback((type: NotificationType) => {
    return notificationService.shouldVibrate(type);
  }, []);

  const getPriority = useCallback((type: NotificationType) => {
    return notificationService.getPriority(type);
  }, []);

  const resetToDefaults = useCallback(() => {
    notificationService.resetToDefaults();
    setSettings(defaultNotificationSettings);
  }, []);

  const formatDNDTime = useCallback((ms: number | null) => {
    return notificationService.formatDNDTimeRemaining(ms);
  }, []);

  return {
    settings,
    updateSettings,
    shouldShowNotification,
    shouldPlaySound,
    shouldVibrate,
    getPriority,
    isDNDActive,
    dndTimeRemaining,
    dndTimeFormatted: notificationService.formatDNDTimeRemaining(dndTimeRemaining),
    resetToDefaults,
    formatDNDTime,
  };
};
