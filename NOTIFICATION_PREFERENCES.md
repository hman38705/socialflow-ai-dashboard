# Notification Preferences Implementation

## Overview

The Notification Preferences system provides users with comprehensive control over how and when they receive notifications. The implementation includes support for:

- **Notification Types**: Payment, Transfer, and Contract notifications
- **Priority Levels**: High, Medium, and Low
- **Quiet Hours**: Scheduled time periods for muted notifications
- **Do-Not-Disturb Mode**: Temporary suspension of notifications with exceptions
- **Notification Channels**: Email, Push, and In-App notifications
- **Sound and Vibration**: Per-notification-type control

## Project Structure

### Types (`types/notifications.ts`)

Defines the TypeScript interfaces for notification settings:

```typescript
- NotificationType: 'payment' | 'transfer' | 'contract'
- NotificationPriority: 'high' | 'medium' | 'low'
- NotificationPreference: Configuration for each notification type
- QuietHoursConfig: Configures quiet hours (start/end times)
- DoNotDisturbMode: DND settings with expiration and exceptions
- NotificationSettings: Complete user notification settings
```

### Components

#### NotificationPreferences (`components/NotificationPreferences.tsx`)

Main modal component for managing notification preferences. Features:

- **Tabbed Interface**:
  - Notification Types tab: Configure individual notification types
  - Quiet Hours tab: Set quiet hours schedule
  - Do Not Disturb tab: Enable/configure DND mode

- **Global Settings**:
  - Email Notifications toggle
  - Push Notifications toggle
  - In-App Notifications toggle

- **Per-Type Configuration**:
  - Enable/disable by type
  - Priority level selection
  - Sound toggle
  - Vibration toggle

- **Quiet Hours**:
  - Enable/disable quiet hours
  - Start and end time selectors
  - Option to allow high-priority notifications to break through

- **Do-Not-Disturb**:
  - Enable/disable DND
  - Duration selection (1h, 2h, 8h, indefinite)
  - Exception management (allow specific notification types)

#### NotificationToast (`components/NotificationToast.tsx`)

Display component for notification toasts:

- **NotificationToast**: Individual notification display
- **NotificationContainer**: Manages multiple notification toasts in a stack
- Auto-dismissal based on priority (high priority stays visible longer)
- Smooth animations and transitions

### Services

#### NotificationService (`services/notificationService.ts`)

Singleton service for notification management:

```typescript
// Check if notification should be shown
shouldShowNotification(type: NotificationType): boolean

// Get audio/vibration preferences
shouldPlaySound(type: NotificationType): boolean
shouldVibrate(type: NotificationType): boolean

// DND management
isDNDActive(): boolean
getDNDTimeRemaining(): number | null
formatDNDTimeRemaining(ms: number | null): string

// Settings management
updateSettings(settings: NotificationSettings): void
getSettings(): NotificationSettings
resetToDefaults(): void
```

### Hooks

#### useNotificationPreferences (`hooks/useNotificationPreferences.ts`)

React hook for accessing notification preferences in components:

```typescript
// Returns:
{
  settings: NotificationSettings;
  updateSettings: (settings) => void;
  shouldShowNotification: (type) => boolean;
  shouldPlaySound: (type) => boolean;
  shouldVibrate: (type) => boolean;
  getPriority: (type) => NotificationPriority;
  isDNDActive: boolean;
  dndTimeRemaining: number | null;
  dndTimeFormatted: string;
  resetToDefaults: () => void;
}
```

#### useNotificationQueue (`hooks/useNotificationQueue.ts`)

React hook for managing a queue of notifications to display:

```typescript
// Returns:
{
  notifications: NotificationMessage[];
  addNotification: (notification) => void;
  removeNotification: (id) => void;
  clearAll: () => void;
}
```

### Utilities

#### notificationUtils (`utils/notificationUtils.ts`)

Helper functions for notifications:

- `getNotificationIcon(type)`: Get emoji icon for notification type
- `getPriorityColor(priority)`: Get color for priority level
- `getPriorityBgClass(priority)`: Get Tailwind CSS class for background
- `formatNotificationTime(timestamp)`: Format relative time
- `sendNotification(notification)`: Send notification with preference checking
- `playNotificationSound()`: Play notification sound
- `vibrateDevice()`: Vibrate device
- `requestNotificationPermission()`: Request browser notification permission
- `createSampleNotification()`: Create sample notification for preview
- `initializeNotifications()`: Initialize notification system on app load

## Usage Examples

### Using NotificationPreferences Modal

```typescript
import { NotificationPreferences } from './components/NotificationPreferences';

function Settings() {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <>
      <button onClick={() => setShowNotifications(true)}>
        Notification Settings
      </button>

      {showNotifications && (
        <NotificationPreferences
          onClose={() => setShowNotifications(false)}
        />
      )}
    </>
  );
}
```

### Using Notification Hook

```typescript
import { useNotificationPreferences } from './hooks/useNotificationPreferences';

function MyComponent() {
  const { 
    shouldShowNotification,
    isDNDActive,
    dndTimeFormatted
  } = useNotificationPreferences();

  if (isDNDActive) {
    return <div>DND active: {dndTimeFormatted}</div>;
  }

  if (shouldShowNotification('payment')) {
    // Show payment notification
  }
}
```

### Sending a Notification

```typescript
import { sendNotification } from './utils/notificationUtils';
import { useNotificationQueue } from './hooks/useNotificationQueue';

function TransactionComponent() {
  const { addNotification } = useNotificationQueue();

  const handlePayment = async () => {
    // Process payment...
    
    addNotification({
      id: `payment-${Date.now()}`,
      type: 'payment',
      title: 'Payment Successful',
      message: 'Payment of $50 received',
      priority: 'high',
      timestamp: Date.now()
    });
  };
}
```

### Display Notifications

```typescript
import { useNotificationQueue } from './hooks/useNotificationQueue';
import { NotificationContainer } from './components/NotificationToast';

function App() {
  const { notifications, removeNotification } = useNotificationQueue();

  return (
    <div>
      <NotificationContainer
        notifications={notifications}
        onDismiss={removeNotification}
      />
      {/* Rest of app */}
    </div>
  );
}
```

## Settings Storage

Notification settings are automatically persisted to localStorage under the key `notificationSettings`. Settings are stored as JSON and include:

```json
{
  "notifications": {
    "payment": {
      "type": "payment",
      "enabled": true,
      "priority": "high",
      "sound": true,
      "vibration": true
    },
    "transfer": { ... },
    "contract": { ... }
  },
  "quietHours": {
    "enabled": false,
    "startTime": "22:00",
    "endTime": "08:00",
    "allowHighPriority": true
  },
  "doNotDisturb": {
    "enabled": false,
    "expiresAt": null,
    "exceptions": []
  },
  "emailNotifications": true,
  "pushNotifications": true,
  "inAppNotifications": true
}
```

## Notification Decision Logic

The system determines whether to show a notification using the following logic:

1. **Check if notification type is enabled**: If disabled, don't show
2. **Check DND status**: 
   - If active and notification not in exceptions, don't show
   - If DND has expired, ignore DND
3. **Check Quiet Hours**:
   - If in quiet hours and priority < high, don't show
   - If in quiet hours but high priority allowed, allow
4. **Check global channels**: Ensure appropriate channel is enabled

## Features

### ✅ Implemented

- [x] Notification settings UI with three tabs
- [x] Notification type configuration (payment, transfer, contract)
- [x] Priority level selection (high, medium, low)
- [x] Per-type sound and vibration control
- [x] Quiet hours configuration with time selectors
- [x] High-priority override during quiet hours
- [x] Do-Not-Disturb mode
- [x] DND duration options (1h, 2h, 8h, indefinite)
- [x] DND type exceptions
- [x] Global notification channels (email, push, in-app)
- [x] Settings persistence to localStorage
- [x] NotificationService singleton for settings management
- [x] React hooks for component integration
- [x] Notification toast components with animations
- [x] Notification queue management
- [x] Utility functions for notification handling

## Browser Compatibility

- **Vibration API**: Supported on most modern mobile browsers
- **Notification API**: Requires user permission, supported on modern browsers
- **localStorage**: Standard support across all modern browsers

## Testing

The implementation includes:
- Type-safe interfaces with TypeScript
- Singleton pattern for NotificationService with lazy initialization
- localStorage-based persistence
- Reactive updates via React hooks
- Smooth UI transitions with Tailwind CSS

## Future Enhancements

- [ ] Server-side notification preferences sync
- [ ] Scheduled quiet hours (recurring daily)
- [ ] Smart notifications based on activity patterns
- [ ] Custom DND scheduling
- [ ] Notification categories and filtering
- [ ] Desktop notification API integration
- [ ] Push notification service integration
- [ ] Email notification templates
