import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToastProvider, useToast } from './ToastContext';

// framer-motion's AnimatePresence defers unmount for the exit animation, which
// would break the "dismiss removes it now" assertions. Render children plainly.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
      <div {...rest}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

// === helpers

function renderWithProvider() {
  let api: ReturnType<typeof useToast>;

  function Consumer() {
    api = useToast();
    return null;
  }

  const utils = render(
    <ToastProvider>
      <Consumer />
    </ToastProvider>,
  );

  // @ts-expect-error assigned synchronously inside Consumer's render
  return { api: api!, ...utils };
}

// === useToast outside provider

test('useToast() throws a named error when used outside ToastProvider', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useToast())).toThrow(
    'useToast must be used within a ToastProvider',
  );
  spy.mockRestore();
});

// === API shape

test('useToast() exposes toast, success, error, warning, info, dismiss, dismissAll', () => {
  const { api } = renderWithProvider();
  for (const key of ['toast', 'success', 'error', 'warning', 'info', 'dismiss', 'dismissAll']) {
    expect(typeof (api as unknown as Record<string, unknown>)[key]).toBe('function');
  }
});

// === auto-dismiss

describe('auto-dismiss', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a non-loading toast is removed after 3800 ms', () => {
    const { api } = renderWithProvider();

    act(() => {
      api.success('Saved');
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3799));
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  test('a loading toast is NOT auto-dismissed', () => {
    const { api } = renderWithProvider();

    act(() => {
      api.toast('Working…', 'loading');
    });
    act(() => vi.advanceTimersByTime(10_000));

    expect(screen.getByText('Working…')).toBeInTheDocument();
  });
});

// === ids and dismissal

describe('ids and dismissal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('toast() returns a non-empty string id', () => {
    const { api } = renderWithProvider();
    let id = '';
    act(() => {
      id = api.info('Check id');
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('ids are unique even for many toasts created in one tick', () => {
    const { api } = renderWithProvider();
    const ids: string[] = [];
    act(() => {
      for (let i = 0; i < 50; i++) ids.push(api.info(`Toast ${i}`));
    });
    expect(new Set(ids).size).toBe(50);
  });

  test('dismiss(id) removes only the targeted toast', () => {
    const { api } = renderWithProvider();
    let removeId = '';
    act(() => {
      api.toast('Keep me', 'loading');
      removeId = api.toast('Remove me', 'loading');
    });

    act(() => api.dismiss(removeId));

    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(screen.queryByText('Remove me')).not.toBeInTheDocument();
  });

  test('dismissAll() clears every toast', () => {
    const { api } = renderWithProvider();
    act(() => {
      api.toast('One', 'loading');
      api.toast('Two', 'loading');
      api.toast('Three', 'loading');
    });

    act(() => api.dismissAll());

    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.queryByText('Two')).not.toBeInTheDocument();
    expect(screen.queryByText('Three')).not.toBeInTheDocument();
  });
});

// === dedupe

describe('duplicate suppression', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('an identical message within 2s bumps a count instead of stacking', () => {
    const { api } = renderWithProvider();

    act(() => {
      api.info('Rate limited');
    });
    act(() => vi.advanceTimersByTime(500));
    act(() => {
      api.info('Rate limited');
    });

    expect(screen.getAllByText('Rate limited')).toHaveLength(1);
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  test('the same message after the window stacks a second toast', () => {
    const { api } = renderWithProvider();

    act(() => {
      api.toast('Still here', 'loading');
    });
    act(() => vi.advanceTimersByTime(2001));
    act(() => {
      api.toast('Still here', 'loading');
    });

    expect(screen.getAllByText('Still here')).toHaveLength(2);
  });
});

// === unmount

test('timers are cleared on unmount (no post-unmount state update)', () => {
  vi.useFakeTimers();
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const { api, unmount } = renderWithProvider();
  act(() => {
    api.success('Bye');
  });

  unmount();
  act(() => vi.advanceTimersByTime(5000));

  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
  vi.useRealTimers();
});
