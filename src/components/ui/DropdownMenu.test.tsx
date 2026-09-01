import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DropdownMenu, type DropdownItem } from './DropdownMenu';

const onEdit = vi.fn();
const onArchive = vi.fn();
const onDelete = vi.fn();

const items: DropdownItem[] = [
  { label: 'Edit', onSelect: onEdit },
  { label: 'Archive', onSelect: onArchive, disabled: true },
  { type: 'separator' },
  { label: 'Delete', onSelect: onDelete, destructive: true },
];

function Harness() {
  return (
    <DropdownMenu
      label="Row actions"
      items={items}
      trigger={(props) => (
        <button
          ref={props.ref}
          onClick={props.onClick}
          onKeyDown={props.onKeyDown}
          aria-haspopup={props['aria-haspopup']}
          aria-expanded={props['aria-expanded']}
        >
          Actions
        </button>
      )}
    />
  );
}

function key(k: string) {
  act(() => {
    const el = document.activeElement ?? document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

beforeEach(() => {
  onEdit.mockClear();
  onArchive.mockClear();
  onDelete.mockClear();
});

describe('DropdownMenu', () => {
  test('ArrowDown on the trigger opens the menu and focuses the first item', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    act(() => trigger.focus());
    key('ArrowDown');

    expect(screen.getByRole('menu', { name: 'Row actions' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  test('ArrowDown navigation skips the disabled item', () => {
    render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Actions' }).click());
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

    key('ArrowDown');
    // Archive is disabled -> focus lands on Delete
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();

    key('ArrowDown'); // wraps back to Edit
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  test('typeahead jumps to the first matching label', () => {
    render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Actions' }).click());
    key('d');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  test('Escape closes the menu and restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Actions' });
    act(() => trigger.click());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    key('Escape');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test('activating an item runs its handler and closes', () => {
    render(<Harness />);
    act(() => screen.getByRole('button', { name: 'Actions' }).click());
    act(() => screen.getByRole('menuitem', { name: 'Edit' }).click());

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
