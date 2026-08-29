import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { NotFoundPage } from './NotFoundPage';
import { ForbiddenPage } from './ForbiddenPage';

const trackEvent = vi.fn();
vi.mock('../lib/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

beforeEach(() => trackEvent.mockClear());

describe('NotFoundPage', () => {
  test('renders the recovery links', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
      'href',
      expect.stringContaining('mailto:'),
    );
  });

  test('fires a single not_found telemetry event across re-renders', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/ghost']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter initialEntries={['/ghost']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter initialEntries={['/ghost']}>
        <NotFoundPage />
      </MemoryRouter>,
    );
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('route.not_found', { path: '/ghost' });
  });
});

describe('ForbiddenPage', () => {
  test('is an alert with recovery links and fires no telemetry', () => {
    render(
      <MemoryRouter>
        <ForbiddenPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/');
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
