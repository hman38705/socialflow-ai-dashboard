/**
 * Event Bus
 *
 * Lightweight in-process publish/subscribe bus used to decouple modules that
 * emit domain events from the modules that react to them. Handlers are
 * registered per event name and invoked synchronously when the event is
 * emitted, so keep handlers fast and non-blocking.
 *
 * Usage convention: define event names and payload types in a shared map,
 * subscribe with `on(event, handler)` and publish with `emit(event, payload)`.
 * Errors thrown by a handler are isolated so one failing subscriber does not
 * prevent the remaining handlers from running.
 */

type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Subscribe to an event for a single emission.
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const unsubscribe = this.on<T>(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  /**
   * Remove a previously registered handler.
   */
  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as EventHandler);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Publish an event to all registered handlers. Handler errors are isolated
   * so a single failing subscriber cannot break the others.
   */
  emit<T = unknown>(event: string, payload: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Error in event handler for "${event}":`, error);
      }
    }
  }

  /**
   * Remove all handlers, optionally scoped to a single event.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

export const eventBus = new EventBus();
