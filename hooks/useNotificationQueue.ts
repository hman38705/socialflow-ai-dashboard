import { useState, useCallback } from 'react';
import { NotificationMessage } from '../utils/notificationUtils';

/**
 * Custom hook for managing a queue of notifications
 */
export const useNotificationQueue = () => {
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);

  const addNotification = useCallback((notification: NotificationMessage) => {
    setNotifications((prev) => [...prev, notification]);

    // Auto-remove high priority notifications after 8 seconds
    if (notification.priority === 'high') {
      const timer = setTimeout(() => {
        removeNotification(notification.id);
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
  };
};
