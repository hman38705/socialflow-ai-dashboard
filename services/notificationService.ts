import {
  NotificationSettings,
  NotificationType,
  defaultNotificationSettings,
} from '../types/notifications';

/**
 * Notification Service
 * Handles notification logic based on user preferences and settings
 */

export class NotificationService {
  private static instance: NotificationService;
  private settings: NotificationSettings = defaultNotificationSettings;

  private constructor() {
    this.loadSettings();
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    try {
      const saved = localStorage.getItem('notificationSettings');
      if (saved) {
        this.settings = JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load notification settings:', e);
      this.settings = defaultNotificationSettings;
    }
  }

  /**
   * Update settings
   */
  updateSettings(settings: NotificationSettings): void {
    this.settings = settings;
    localStorage.setItem('notificationSettings', JSON.stringify(settings));
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return this.settings;
  }

  /**
   * Check if a notification should be shown based on current settings
   */
  shouldShowNotification(type: NotificationType): boolean {
    // Check if notification type is enabled
    const notificationConfig = this.settings.notifications[type];
    if (!notificationConfig.enabled) {
      return false;
    }

    // Check if DND is enabled
    if (this.settings.doNotDisturb.enabled) {
      // Check if DND has expired
      if (this.settings.doNotDisturb.expiresAt) {
        if (Date.now() > this.settings.doNotDisturb.expiresAt) {
          // DND has expired
          return true;
        }
      }

      // Check if this notification type is in exceptions
      if (!this.settings.doNotDisturb.exceptions.includes(type)) {
        return false;
      }
    }

    // Check quiet hours
    if (this.settings.quietHours.enabled) {
      if (!this.isOutsideQuietHours()) {
        // We're in quiet hours
        // Only show high priority notifications if allowed
        if (notificationConfig.priority !== 'high') {
          return false;
        }
        if (!this.settings.quietHours.allowHighPriority) {
          return false;
        }
      }
    }

    // Check global notification channels
    switch (type) {
      case 'payment':
      case 'transfer':
      case 'contract':
        // For blockchain notifications, check if in-app notifications are enabled
        return this.settings.inAppNotifications;
      default:
        return true;
    }
  }

  /**
   * Check if current time is outside quiet hours
   */
  private isOutsideQuietHours(): boolean {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const { startTime, endTime } = this.settings.quietHours;

    // Handle times that span midnight (e.g., 22:00 to 08:00)
    if (startTime < endTime) {
      // Same day
      return currentTime < startTime || currentTime > endTime;
    } else {
      // Spans midnight
      return currentTime < startTime && currentTime > endTime;
    }
  }

  /**
   * Get notification sound preference for a type
   */
  shouldPlaySound(type: NotificationType): boolean {
    if (!this.shouldShowNotification(type)) {
      return false;
    }
    return this.settings.notifications[type].sound;
  }

  /**
   * Get notification vibration preference for a type
   */
  shouldVibrate(type: NotificationType): boolean {
    if (!this.shouldShowNotification(type)) {
      return false;
    }
    return this.settings.notifications[type].vibration;
  }

  /**
   * Get notification priority for a type
   */
  getPriority(type: NotificationType) {
    return this.settings.notifications[type].priority;
  }

  /**
   * Check if DND is currently active
   */
  isDNDActive(): boolean {
    if (!this.settings.doNotDisturb.enabled) {
      return false;
    }

    // Check if DND has expired
    if (this.settings.doNotDisturb.expiresAt) {
      return Date.now() <= this.settings.doNotDisturb.expiresAt;
    }

    return true;
  }

  /**
   * Get DND expiration time remaining (in milliseconds)
   */
  getDNDTimeRemaining(): number | null {
    if (!this.isDNDActive()) {
      return null;
    }

    if (!this.settings.doNotDisturb.expiresAt) {
      return Infinity; // Indefinite
    }

    return Math.max(0, this.settings.doNotDisturb.expiresAt - Date.now());
  }

  /**
   * Format time remaining in a human-readable format
   */
  formatDNDTimeRemaining(ms: number | null): string {
    if (ms === null) {
      return 'Not active';
    }

    if (ms === Infinity) {
      return 'Indefinite';
    }

    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Reset to default settings
   */
  resetToDefaults(): void {
    this.settings = defaultNotificationSettings;
    localStorage.setItem('notificationSettings', JSON.stringify(this.settings));
  }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();
