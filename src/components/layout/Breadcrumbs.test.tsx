import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { Breadcrumbs } from './Breadcrumbs';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>,
  );
}

describe('Breadcrumbs', () => {
  test('a nested route renders the crumb chain with the last crumb aria-current', () => {
    renderAt('/settings/security');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Settings']);

    const current = screen.getByText('Security');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelector('a[href="/settings"]')).toBeInTheDocument();
  });

  test('a top-level route renders a single, non-link crumb', () => {
    renderAt('/analytics');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Analytics')).toHaveAttribute('aria-current', 'page');
  });

  test('renders nothing for an unregistered route', () => {
    const { container } = renderAt('/nowhere');
    expect(container).toBeEmptyDOMElement();
  });
});
