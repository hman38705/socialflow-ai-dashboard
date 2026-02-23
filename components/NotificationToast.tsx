import React, { useState, useEffect } from 'react';
import { NotificationMessage } from '../utils/notificationUtils';
import { getPriorityBgClass, getPriorityColor, formatNotificationTime } from '../utils/notificationUtils';

interface NotificationToastProps {
  notification: NotificationMessage;
  onDismiss: (id: string) => void;
  duration?: number;
}

/**
 * Notification Toast Component
 * Displays a single notification toast in the top-right corner
 */
export const NotificationToast: React.FC<NotificationToastProps> = ({
  notification,
  onDismiss,
  duration = 5000,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // Auto-dismiss after duration (only for non-high priority)
    if (notification.priority !== 'high' && duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onDismiss(notification.id), 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.priority, duration, onDismiss]);

  const priorityColors: Record<string, string> = {
    high: 'text-red-400',
    medium: 'text-yellow-400',
    low: 'text-gray-400',
  };

  return (
    <div
      className={`transform transition-all duration-300 ${
        isVisible
          ? 'translate-x-0 opacity-100'
          : 'translate-x-full opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`bg-[#1A1D1F] border border-gray-700 rounded-lg shadow-xl p-4 max-w-sm w-full ${getPriorityBgClass(
          notification.priority
        )}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-white">{notification.title}</h4>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${priorityColors[notification.priority]}`}>
                {notification.priority.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-gray-300 mb-1">{notification.message}</p>
            <span className="text-xs text-gray-500">
              {formatNotificationTime(notification.timestamp)}
            </span>
          </div>
          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(() => onDismiss(notification.id), 300);
            }}
            className="text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
};

interface NotificationContainerProps {
  notifications: NotificationMessage[];
  onDismiss: (id: string) => void;
}

/**
 * Notification Container
 * Manages multiple notification toasts in a stack
 */
export const NotificationContainer: React.FC<NotificationContainerProps> = ({
  notifications,
  onDismiss,
}) => {
  return (
    <div className="fixed top-6 right-6 z-40 flex flex-col gap-3 pointer-events-none">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationToast
            notification={notification}
            onDismiss={onDismiss}
            duration={notification.priority === 'high' ? 0 : 5000}
          />
        </div>
      ))}
    </div>
  );
};
