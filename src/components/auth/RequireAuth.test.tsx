import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { RequireAuth, safeNextPath } from './RequireAuth';

type AuthShape = { status: string; user: { id: string; email: string; roles?: string[] } | null };
let authValue: AuthShape;

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => authValue,
}));
vi.mock('../ui/Spinner', () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

function renderGuardedAt(path: string, roles?: string[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/security"
          element={
            <RequireAuth roles={roles}>
              <p>secret content</p>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('safeNextPath', () => {
  test('keeps a same-origin relative path', () => {
    expect(safeNextPath('/settings/security')).toBe('/settings/security');
    expect(safeNextPath(encodeURIComponent('/a?b=c'))).toBe('/a?b=c');
  });

  test('rejects absolute and protocol-relative values', () => {
    expect(safeNextPath('https://evil.tld')).toBe('/');
    expect(safeNextPath('//evil.tld')).toBe('/');
    expect(safeNextPath('/\\evil.tld')).toBe('/');
    expect(safeNextPath('/javascript:alert(1)')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});

describe('RequireAuth', () => {
  test('while auth is initializing it shows LoadingScreen, never the login page', () => {
    authValue = { status: 'loading', user: null };
    renderGuardedAt('/settings/security');
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  test('an unauthenticated user is redirected to /login with an encoded next', () => {
    authValue = { status: 'unauthenticated', user: null };
    renderGuardedAt('/settings/security');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  test('carries the current path+search as next', () => {
    authValue = { status: 'unauthenticated', user: null };
    render(
      <MemoryRouter initialEntries={['/settings/security?tab=1']}>
        <Routes>
          <Route
            path="/settings/security"
            element={
              <RequireAuth>
                <p>secret</p>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<SearchEcho />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('search')).toHaveTextContent(
      '?next=%2Fsettings%2Fsecurity%3Ftab%3D1',
    );
  });

  test('an authenticated user sees the content', () => {
    authValue = { status: 'authenticated', user: { id: 'u1', email: 'a@b.co' } };
    renderGuardedAt('/settings/security');
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  test('signed in but missing a required role renders 403, not a redirect', () => {
    authValue = { status: 'authenticated', user: { id: 'u1', email: 'a@b.co', roles: ['member'] } };
    renderGuardedAt('/settings/security', ['admin']);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
});

function SearchEcho() {
  return <span data-testid="search">{useLocation().search}</span>;
}
