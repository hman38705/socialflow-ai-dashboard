import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { CommandPalette } from './CommandPalette';

const getSearch = vi.fn();
vi.mock('../../api/services/SearchService', () => ({
  SearchService: { getSearch: (args: { q: string }) => getSearch(args) },
}));
vi.mock('../../contexts/ComposerContext', () => ({
  useComposer: () => ({ openComposer: vi.fn() }),
}));

/** A resolvable, cancelable-looking promise. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  }) as Promise<T> & { cancel: () => void };
  promise.cancel = vi.fn();
  return { promise, resolve };
}

function open() {
  render(
    <MemoryRouter>
      <CommandPalette />
      <input aria-label="outside field" />
    </MemoryRouter>,
  );
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  });
}

beforeEach(() => {
  getSearch.mockReset();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('CommandPalette', () => {
  test('the shortcut is ignored while focus is in a text field', () => {
    render(
      <MemoryRouter>
        <CommandPalette />
        <input aria-label="outside field" />
      </MemoryRouter>,
    );
    const field = screen.getByLabelText('outside field');
    field.focus();
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
    });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  test('opens on the shortcut and shows the Navigation and Actions sections', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Go to Analytics/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /New post/ })).toBeInTheDocument();
  });

  test('search is debounced by 250ms', () => {
    vi.useFakeTimers();
    getSearch.mockReturnValue(deferred().promise);
    open();

    const input = screen.getByRole('combobox');
    // three rapid keystrokes
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    act(() => vi.advanceTimersByTime(249));
    expect(getSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(getSearch).toHaveBeenCalledTimes(1);
    expect(getSearch).toHaveBeenCalledWith({ q: 'abc' });
  });

  test('a stale search response never overwrites newer results', async () => {
    vi.useFakeTimers();
    const first = deferred<{ results: Array<{ id: string; title: string }> }>();
    const second = deferred<{ results: Array<{ id: string; title: string }> }>();
    getSearch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    open();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'one' } });
    act(() => vi.advanceTimersByTime(250)); // request 1 in flight

    fireEvent.change(input, { target: { value: 'two' } });
    act(() => vi.advanceTimersByTime(250)); // request 2 in flight

    // request 2 resolves first, then the stale request 1 resolves
    await act(async () => {
      second.resolve({ results: [{ id: 's2', title: 'Newer result' }] });
    });
    await act(async () => {
      first.resolve({ results: [{ id: 's1', title: 'Stale result' }] });
    });

    expect(screen.getByRole('option', { name: /Newer result/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Stale result/ })).not.toBeInTheDocument();
  });
});
