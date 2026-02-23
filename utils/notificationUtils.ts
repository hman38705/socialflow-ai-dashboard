/**
 * Notification Utilities
 * Helper functions for displaying and managing notifications
 */

import { NotificationType, NotificationPriority } from '../types/notifications';
import { notificationService } from '../services/notificationService';

export interface NotificationMessage {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  timestamp: number;
}

/**
 * Get icon for notification type
 */
export const getNotificationIcon = (type: NotificationType): string => {
  switch (type) {
    case 'payment':
      return '💳';
    case 'transfer':
      return '🔄';
    case 'contract':
      return '📋';
    default:
      return '🔔';
  }
};

/**
 * Get color for notification priority
 */
export const getPriorityColor = (priority: NotificationPriority): string => {
  switch (priority) {
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'gray';
  }
};

/**
 * Get background color class for priority
 */
export const getPriorityBgClass = (priority: NotificationPriority): string => {
  switch (priority) {
    case 'high':
      return 'bg-red-500/20 border-red-500/50';
    case 'medium':
      return 'bg-yellow-500/20 border-yellow-500/50';
    case 'low':
      return 'bg-gray-500/20 border-gray-500/50';
  }
};

/**
 * Format notification timestamp
 */
export const formatNotificationTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return 'just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
};

/**
 * Send a notification with proper handling of user preferences
 */
export const sendNotification = async (
  notification: NotificationMessage
): Promise<void> => {
  // Check if notification should be shown according to preferences
  if (!notificationService.shouldShowNotification(notification.type)) {
    return;
  }

  // Play sound if enabled
  if (notificationService.shouldPlaySound(notification.type)) {
    playNotificationSound();
  }

  // Vibrate device if enabled
  if (notificationService.shouldVibrate(notification.type)) {
    vibrateDevice();
  }

  // Show browser/system notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(notification.title, {
      body: notification.message,
      icon: getNotificationIcon(notification.type),
      tag: notification.id,
      requireInteraction: notification.priority === 'high',
    });
  }
};

/**
 * Play notification sound
 */
export const playNotificationSound = (): void => {
  try {
    const audio = new Audio(
      'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YCIAAAAAAAA='
    );
    audio.play().catch((e) => console.log('Could not play notification sound:', e));
  } catch (e) {
    console.error('Error playing notification sound:', e);
  }
};

/**
 * Vibrate device
 */
export const vibrateDevice = (): void => {
  if ('vibrate' in navigator) {
    // Vibrate with pattern: short vibration
    navigator.vibrate([200]);
  }
};

/**
 * Request notification permission
 */
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!('Notification' in window)) {
    console.log('This browser does not support notifications');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  return false;
};

/**
 * Create a sample notification for preview purposes
 */
export const createSampleNotification = (
  type: NotificationType,
  priority: NotificationPriority
): NotificationMessage => {
  const messages: Record<NotificationType, Record<string, string>> = {
    payment: {
      title: 'Payment Received',
      message: 'You received $50.00 from John Doe',
    },
    transfer: {
      title: 'Transfer Complete',
      message: 'You sent 100 USDC to wallet address',
    },
    contract: {
      title: 'Contract Update',
      message: 'Smart contract deployment completed successfully',
    },
  };

  return {
    id: `sample-${type}-${Date.now()}`,
    type,
    title: messages[type].title,
    message: messages[type].message,
    priority,
    timestamp: Date.now(),
  };
};

/**
 * Initialize notification service on app load
 */
export const initializeNotifications = async (): Promise<void> => {
  // Request notification permission if not already granted
  await requestNotificationPermission();

  // Load user preferences (this is done automatically by NotificationService)
  // but we can trigger any additional initialization here if needed
};
