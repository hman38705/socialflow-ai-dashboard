import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform } from '../../types';
import { CharacterCounter } from './CharacterCounter';

describe('CharacterCounter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the remaining character count for the platform', () => {
    render(<CharacterCounter text="hello" platform={Platform.TWITTER} />);
    expect(screen.getByText('275')).toBeInTheDocument();
  });

  it('calls onOverLimitChange(true) as soon as the text crosses the limit', () => {
    const onOverLimitChange = vi.fn();
    const text = 'a'.repeat(281);
    render(
      <CharacterCounter
        text={text}
        platform={Platform.TWITTER}
        onOverLimitChange={onOverLimitChange}
      />,
    );
    expect(onOverLimitChange).toHaveBeenCalledWith(true);
  });

  it('calls onOverLimitChange(false) when under the limit', () => {
    const onOverLimitChange = vi.fn();
    render(
      <CharacterCounter
        text="hi"
        platform={Platform.TWITTER}
        onOverLimitChange={onOverLimitChange}
      />,
    );
    expect(onOverLimitChange).toHaveBeenCalledWith(false);
  });

  it('marks the over-limit state via data-state for styling/testing', () => {
    const text = 'a'.repeat(281);
    const { container } = render(<CharacterCounter text={text} platform={Platform.TWITTER} />);
    expect(container.firstChild).toHaveAttribute('data-state', 'over');
  });

  it('throttles the polite screen-reader announcement instead of firing every keystroke', () => {
    const { rerender } = render(
      <CharacterCounter text="h" platform={Platform.TWITTER} announceDelayMs={500} />,
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('');

    // Rapid keystrokes, each well under the debounce delay.
    rerender(<CharacterCounter text="he" platform={Platform.TWITTER} announceDelayMs={500} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<CharacterCounter text="hel" platform={Platform.TWITTER} announceDelayMs={500} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(<CharacterCounter text="hell" platform={Platform.TWITTER} announceDelayMs={500} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Still not announced — typing hasn't settled yet.
    expect(liveRegion).toHaveTextContent('');

    // Let the debounce settle after the last keystroke.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(liveRegion).toHaveTextContent('276 characters remaining');
  });

  it('announces an over-limit message once settled', () => {
    const text = 'a'.repeat(285);
    render(<CharacterCounter text={text} platform={Platform.TWITTER} announceDelayMs={300} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      '5 characters over the 280 character limit',
    );
  });
});
