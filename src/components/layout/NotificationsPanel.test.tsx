import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  NotificationsPanel,
  groupByRecency,
  unreadLabel,
  type AppNotification,
} from './NotificationsPanel';

const HOUR = 60 * 60 * 1000;

function makeItems(): AppNotification[] {
  const now = Date.now();
  return [
    { id: 'a', title: 'Fresh one', timestamp: now - HOUR, read: false },
    { id: 'b', title: 'Also today', timestamp: now - 3 * HOUR, read: false },
    { id: 'c', title: 'Yesterday', timestamp: now - 30 * HOUR, read: true },
  ];
}

function source(overrides: Partial<Parameters<typeof NotificationsPanel>[0]['source']> = {}) {
  return {
    items: makeItems(),
    persistMarkRead: async () => {},
    persistMarkAllRead: async () => {},
    ...overrides,
  };
}

describe('grouping and counting helpers', () => {
  test('groupByRecency splits on start-of-today', () => {
    const { today, earlier } = groupByRecency(makeItems());
    expect(today.map((n) => n.id)).toEqual(['a', 'b']);
    expect(earlier.map((n) => n.id)).toEqual(['c']);
  });

  test('unreadLabel speaks the exact count (the badge, not the label, caps at 9+)', () => {
    expect(unreadLabel(3)).toBe('3 unread notifications');
    expect(unreadLabel(42)).toBe('42 unread notifications');
  });
});

describe('NotificationsPanel', () => {
  test('bell exposes the unread count as its accessible name and a capped badge', () => {
    const many: AppNotification[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      title: `n${i}`,
      timestamp: Date.now(),
      read: false,
    }));
    render(<NotificationsPanel source={source({ items: many })} />);
    const bell = screen.getByRole('button', { name: '12 unread notifications' });
    expect(within(bell).getByText('9+')).toBeInTheDocument();
  });

  test('opens a drawer grouped into Today / Earlier', () => {
    render(<NotificationsPanel source={source()} />);
    act(() => screen.getByRole('button', { name: /unread notifications/ }).click());
    const dialog = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(dialog).getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Earlier' })).toBeInTheDocument();
  });

  test('mark all as read is optimistic and rolls back when the persist call fails', async () => {
    const failing = source({
      persistMarkAllRead: () => Promise.reject(new Error('offline')),
    });
    render(<NotificationsPanel source={failing} />);
    act(() => screen.getByRole('button', { name: /unread notifications/ }).click());

    act(() => screen.getByRole('button', { name: 'Mark all as read' }).click());
    // optimistic: the button disappears because unreadCount hit 0
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();

    // rollback: the unread state (and the action) comes back
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeInTheDocument(),
    );
  });

  test('mark all as read sticks when the persist call succeeds', async () => {
    render(<NotificationsPanel source={source()} />);
    act(() => screen.getByRole('button', { name: /unread notifications/ }).click());
    act(() => screen.getByRole('button', { name: 'Mark all as read' }).click());

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });
});
