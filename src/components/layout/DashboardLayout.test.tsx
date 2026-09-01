import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import { DashboardLayout } from './DashboardLayout';

vi.mock('./Sidebar', () => ({
  Sidebar: () => (
    <aside>
      <nav aria-label="Main" />
    </aside>
  ),
}));
vi.mock('./Topbar', () => ({
  Topbar: () => <header>topbar</header>,
}));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/analytics" element={<p>outlet content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardLayout', () => {
  test('renders the routed outlet content', () => {
    renderLayout();
    expect(screen.getByText('outlet content')).toBeInTheDocument();
  });

  test('has exactly one <main>', () => {
    renderLayout();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  test('the first focusable element is a skip link targeting #main', () => {
    renderLayout();
    const skip = screen.getByRole('link', { name: /skip to content/i });
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });
});
