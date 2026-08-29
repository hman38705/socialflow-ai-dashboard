import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { expectNoA11yViolations } from '@/test/a11y';
import { ToastViewport, type ToastData } from './Toast';

// framer-motion's AnimatePresence and motion components are not relevant to
// the presentational behavior under test and require browser layout APIs.
// Mock them so they render their children synchronously.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      layout: _layout, // motion-only prop — would otherwise warn on a plain div
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
      layout?: boolean;
    }) => <div {...rest}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const TOASTS: ToastData[] = [
  { id: 'a', kind: 'success', message: 'Profile updated.' },
  { id: 'b', kind: 'error', message: 'Could not save your changes.' },
  { id: 'c', kind: 'info', message: 'Sync in progress.' },
  { id: 'd', kind: 'loading', message: 'Uploading…' },
];

describe('ToastViewport (presentational)', () => {
  it('renders every toast with its message', () => {
    render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    for (const t of TOASTS) {
      expect(screen.getByText(t.message)).toBeInTheDocument();
    }
  });

  it('annotates each card with its kind via data-kind', () => {
    const { container } = render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    for (const t of TOASTS) {
      const card = container.querySelector(`[data-kind="${t.kind}"]`);
      expect(card).not.toBeNull();
      expect(card?.textContent).toContain(t.message);
    }
  });

  it('marks the loading toast icon as spinning', () => {
    const { container } = render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    const loadingCard = container.querySelector('[data-kind="loading"]');
    expect(loadingCard?.querySelector('svg')).toHaveClass('animate-spin');
  });

  it('exposes the stack as a polite live region for screen readers', () => {
    const { container } = render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('gives every dismiss button an accessible label', () => {
    render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(TOASTS.length);
  });

  it('calls onDismiss with the dismissed toast id', () => {
    const onDismiss = vi.fn();
    render(<ToastViewport toasts={TOASTS} onDismiss={onDismiss} />);

    // Find the dismiss button inside the error card and click it.
    const errorCard = screen.getByText('Could not save your changes.').closest('[data-kind="error"]');
    const dismissButton = errorCard?.querySelector('button');
    expect(dismissButton).not.toBeNull();
    dismissButton!.click();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('b');
  });

  it('renders nothing when the list is empty', () => {
    const { container } = render(<ToastViewport toasts={[]} onDismiss={vi.fn()} />);
    expect(container.querySelector('[data-kind]')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Dismiss' })).toHaveLength(0);
  });

  it('has no serious/critical a11y violations', async () => {
    const { container } = render(<ToastViewport toasts={TOASTS} onDismiss={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});
