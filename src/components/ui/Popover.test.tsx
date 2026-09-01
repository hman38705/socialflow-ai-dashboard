import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Popover } from './Popover';

function Harness() {
  return (
    <div>
      <button>outside</button>
      <Popover
        trigger={(props) => (
          <button ref={props.ref} onClick={props.onClick} aria-expanded={props['aria-expanded']}>
            Open
          </button>
        )}
      >
        <button>inside action</button>
      </Popover>
    </div>
  );
}

describe('Popover', () => {
  test('click toggles the panel open', () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('button', { name: 'Open' }).click();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('outside pointerdown closes it', () => {
    render(<Harness />);
    act(() => {
      screen.getByRole('button', { name: 'Open' }).click();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      screen
        .getByRole('button', { name: 'outside' })
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Escape closes it and restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    act(() => {
      trigger.click();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
