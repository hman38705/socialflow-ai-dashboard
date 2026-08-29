import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('opens on focus after the open delay and links via aria-describedby', () => {
    render(
      <Tooltip content="Save the draft" openDelay={300}>
        <button>Save</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Save' });

    act(() => {
      trigger.focus();
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(300));

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Save the draft');
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
  });

  test('Escape closes an open tooltip', () => {
    render(
      <Tooltip content="hello" openDelay={0}>
        <button>Trigger</button>
      </Tooltip>,
    );
    act(() => {
      screen.getByRole('button').focus();
    });
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('blur closes after the close delay', () => {
    render(
      <Tooltip content="hello" openDelay={0} closeDelay={100}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button');
    act(() => {
      trigger.focus();
    });
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      trigger.blur();
    });
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
