import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { Topbar, titleForPath } from './Topbar';

const openComposer = vi.fn();

vi.mock('../../contexts/ComposerContext', () => ({
  useComposer: () => ({ openComposer }),
}));
vi.mock('./OrgSwitcher', () => ({ OrgSwitcher: () => <div data-testid="org-switcher" /> }));
vi.mock('./NotificationsPanel', () => ({ NotificationsPanel: () => <div data-testid="notifs" /> }));

beforeEach(() => openComposer.mockClear());

describe('titleForPath', () => {
  test('longest matching prefix wins; unknown falls back to Dashboard', () => {
    expect(titleForPath('/settings/profile')).toBe('Settings');
    expect(titleForPath('/analytics')).toBe('Analytics');
    expect(titleForPath('/nowhere')).toBe('Dashboard');
  });
});

describe('Topbar', () => {
  test('the title tracks the route and updates document.title', () => {
    const analytics = render(
      <MemoryRouter initialEntries={['/analytics']}>
        <Topbar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Analytics');
    expect(document.title).toBe('Analytics · SocialFlow AI');
    analytics.unmount();

    render(
      <MemoryRouter initialEntries={['/settings/profile']}>
        <Topbar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(document.title).toBe('Settings · SocialFlow AI');
  });

  test('the New post button opens the composer', () => {
    render(
      <MemoryRouter initialEntries={['/analytics']}>
        <Topbar />
      </MemoryRouter>,
    );
    act(() => screen.getByRole('button', { name: /new post/i }).click());
    expect(openComposer).toHaveBeenCalledTimes(1);
  });
});
