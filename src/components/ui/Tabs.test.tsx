import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { Tabs, type TabDef } from './Tabs';

// framer-motion's layout animation needs browser layout APIs; the underline is not
// under test, so stub `motion.div` to a plain div.
vi.mock('framer-motion', () => ({
  motion: {
    div: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  },
}));

const tabs: TabDef[] = [
  { id: 'one', label: 'One', content: <p>Panel one</p> },
  { id: 'two', label: 'Two', content: <p>Panel two</p> },
  { id: 'three', label: 'Three', content: <p>Panel three</p> },
];

function LocationProbe() {
  return <span data-testid="loc">{useLocation().search}</span>;
}

function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

describe('Tabs', () => {
  test('only the active panel is rendered', () => {
    render(
      <MemoryRouter>
        <Tabs tabs={tabs} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Panel one')).toBeInTheDocument();
    expect(screen.queryByText('Panel two')).not.toBeInTheDocument();
  });

  test('arrow keys move focus but activation is manual', () => {
    render(
      <MemoryRouter>
        <Tabs tabs={tabs} />
      </MemoryRouter>,
    );
    const tablist = screen.getByRole('tablist');
    const firstTab = screen.getByRole('tab', { name: 'One' });
    act(() => firstTab.focus());

    key(tablist, 'ArrowRight');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    // focus moved, but panel one is still shown until activation
    expect(screen.getByText('Panel one')).toBeInTheDocument();

    key(screen.getByRole('tab', { name: 'Two' }), 'Enter');
    expect(screen.getByText('Panel two')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Home and End jump to the ends', () => {
    render(
      <MemoryRouter>
        <Tabs tabs={tabs} />
      </MemoryRouter>,
    );
    act(() => screen.getByRole('tab', { name: 'One' }).focus());
    key(screen.getByRole('tablist'), 'End');
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    key(screen.getByRole('tablist'), 'Home');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
  });

  test('urlParam syncs the active tab to the query string', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Tabs tabs={tabs} urlParam="tab" />
        <LocationProbe />
      </MemoryRouter>,
    );
    act(() => screen.getByRole('tab', { name: 'Two' }).click());
    expect(screen.getByTestId('loc')).toHaveTextContent('tab=two');
  });

  test('reads the initial active tab from the url', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=three']}>
        <Tabs tabs={tabs} urlParam="tab" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Panel three')).toBeInTheDocument();
  });
});
