# Webhook Error Handling Fix

## Summary
Replaced silent error handling (`.catch(() => {})`) with structured logging in webhook delivery and retry paths. This ensures webhook failures are observable and debuggable.

## Changes Made

### 1. `backend/src/modules/webhook/services/WebhookDispatcher.ts`

#### Line 67: `dispatchEvent()` error handler
**Before:**
```typescript
attemptDelivery(delivery.id, sub.url, sub.secret, payload, 1).catch(() => {});
```

**After:**
```typescript
attemptDelivery(delivery.id, sub.url, sub.secret, payload, 1).catch((err) => {
  logger.error('Webhook dispatch failed', { err, deliveryId: delivery.id, url: sub.url });
});
```

#### Line 179: `retryPendingDeliveries()` error handler
**Before:**
```typescript
).catch(() => {}),
```

**After:**
```typescript
).catch((err) => {
  logger.error('Webhook retry failed', {
    err,
    deliveryId: d.id,
    url: d.subscription.url,
  });
}),
```

### 2. `backend/src/controllers/webhooks.ts`

#### Added logger import (line 4)
```typescript
import { createLogger } from '../lib/logger';
```

#### Added logger instance (line 11)
```typescript
const logger = createLogger('WebhooksController');
```

#### Line 183: Webhook replay error handler
**Before:**
```typescript
dispatchEvent(delivery.eventType as any, JSON.parse(delivery.payload)).catch(() => {});
```

**After:**
```typescript
dispatchEvent(delivery.eventType as any, JSON.parse(delivery.payload)).catch((err) => {
  logger.error('Webhook replay dispatch failed', { err, deliveryId: delivery.id });
});
```

## Impact

### Observability
- Failed webhook deliveries are now logged with structured metadata (error, deliveryId, URL)
- Logs are captured by the application's logging pipeline (Winston, Elasticsearch, OpenTelemetry)
- On-call engineers receive alerts when webhook subsystem is degraded

### Debugging
- Error messages and stack traces are preserved for investigation
- Delivery IDs and URLs are included for correlation with database records
- Elasticsearch/Kibana can now index and search webhook failures

### Reliability
- No change to retry logic or persistence (already handled by `attemptDelivery()`)
- Errors are logged but do not block the async flow
- Existing BullMQ retry infrastructure remains intact

## Testing
All changes maintain backward compatibility:
- Webhook delivery behavior unchanged
- Retry scheduling unchanged
- Only adds logging on error paths
- No new dependencies required
