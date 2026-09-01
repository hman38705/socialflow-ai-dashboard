import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { Sidebar } from './Sidebar';

const logout = vi.fn(() => Promise.resolve());

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'sam@example.com' }, logout }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  logout.mockClear();
});

describe('Sidebar', () => {
  test('nav is a list inside <nav aria-label="Main">', () => {
    renderAt('/analytics');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelector('ul')).toBeInTheDocument();
  });

  test('the active route link is marked aria-current="page"', () => {
    renderAt('/scheduler');
    const active = screen.getByRole('link', { name: 'Scheduler' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Analytics' })).not.toHaveAttribute('aria-current');
  });

  test('collapsed state persists across a remount', () => {
    const { unmount } = renderAt('/analytics');
    act(() => screen.getByRole('button', { name: 'Collapse sidebar' }).click());
    expect(localStorage.getItem('sf.sidebar.collapsed')).toBe('true');
    unmount();

    renderAt('/analytics');
    // remounted collapsed: the toggle now offers "Expand"
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  test('Sign out calls the auth context', () => {
    renderAt('/analytics');
    act(() => screen.getByRole('button', { name: /sam@example\.com/ }).click());
    act(() => screen.getByRole('menuitem', { name: 'Sign out' }).click());
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
