/**
 * Tests for src/components/auth/SessionExpiryModal.tsx — FE-048 acceptance criteria:
 *
 *  AC-1  Modal appears at T-2 minutes with "Stay signed in" / "Sign out now"
 *        buttons and a live countdown.
 *  AC-2  Suppressed while a refresh is in-flight or the tab is hidden.
 *  AC-3  Auto-logout at expiry preserves unsaved composer draft.
 *  AC-4  Countdown uses aria-live="polite" and updates at most once per second.
 */

import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  SessionExpiryModal,
  WARN_BEFORE_EXPIRY_S,
  COMPOSER_DRAFT_KEY,
  saveDraft,
  loadDraft,
  clearDraft,
} from '../SessionExpiryModal';
import * as refreshModule from '../../../auth/refresh';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../../auth/refresh', () => ({
  ...jest.requireActual('../../../auth/refresh'),
  logout: jest.fn().mockResolvedValue(undefined),
  refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' }),
}));

const mockLogout = refreshModule.logout as jest.MockedFunction<typeof refreshModule.logout>;
const mockRefreshTokens = refreshModule.refreshTokens as jest.MockedFunction<
  typeof refreshModule.refreshTokens
>;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  sessionStorage.clear();
  mockLogout.mockClear();
  mockRefreshTokens.mockClear();

  // Default: tab is visible
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderModal(
  props: Partial<React.ComponentProps<typeof SessionExpiryModal>> & {
    secondsRemaining?: number | undefined;
  } = {},
) {
  const secondsRemaining = 'secondsRemaining' in props ? props.secondsRemaining : 90;
  return render(
    <SessionExpiryModal
      secondsRemaining={secondsRemaining}
      refreshInFlight={props.refreshInFlight ?? false}
      onStaySignedIn={props.onStaySignedIn}
      onLoggedOut={props.onLoggedOut}
    />,
  );
}

// ---------------------------------------------------------------------------
// AC-1: Appearance and basic content
// ---------------------------------------------------------------------------

describe('AC-1: Modal appearance', () => {
  it('renders when secondsRemaining is within the warning window', () => {
    renderModal({ secondsRemaining: 90 });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('session-expiry-stay')).toBeInTheDocument();
    expect(screen.getByTestId('session-expiry-sign-out')).toBeInTheDocument();
  });

  it('does not render when secondsRemaining is above the warning threshold', () => {
    renderModal({ secondsRemaining: WARN_BEFORE_EXPIRY_S + 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when secondsRemaining is undefined', () => {
    renderModal({ secondsRemaining: undefined });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the initial countdown value', () => {
    renderModal({ secondsRemaining: 90 });
    const countdown = screen.getByTestId('session-expiry-countdown');
    expect(countdown.textContent).toMatch(/1:30/);
  });

  it('has correct accessibility attributes', () => {
    renderModal({ secondsRemaining: 60 });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'session-expiry-title');
  });
});

// ---------------------------------------------------------------------------
// AC-2: Suppression
// ---------------------------------------------------------------------------

describe('AC-2: Suppression', () => {
  it('is suppressed when refreshInFlight is true', () => {
    renderModal({ secondsRemaining: 60, refreshInFlight: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is suppressed when the tab is hidden', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    renderModal({ secondsRemaining: 60 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-4: aria-live countdown ticking at most once per second
// ---------------------------------------------------------------------------

describe('AC-4: aria-live countdown', () => {
  it('countdown element has aria-live="polite"', () => {
    renderModal({ secondsRemaining: 90 });
    const countdown = screen.getByTestId('session-expiry-countdown');
    expect(countdown).toHaveAttribute('aria-live', 'polite');
    expect(countdown).toHaveAttribute('aria-atomic', 'true');
  });

  it('decrements countdown by 1 each second', () => {
    renderModal({ secondsRemaining: 90 });

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('session-expiry-countdown').textContent).toMatch(/1:29/);

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByTestId('session-expiry-countdown').textContent).toMatch(/1:28/);
  });

  it('does not advance the countdown more than once per second', () => {
    renderModal({ secondsRemaining: 10 });

    // Advance by 500 ms — should not have decremented yet
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('session-expiry-countdown').textContent).toMatch(/10s/);

    // Advance the remaining 500 ms — now it should decrement
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('session-expiry-countdown').textContent).toMatch(/9s/);
  });
});

// ---------------------------------------------------------------------------
// Stay signed in (cancels logout)
// ---------------------------------------------------------------------------

describe('"Stay signed in" button', () => {
  it('calls refreshTokens when clicked (no custom handler)', async () => {
    renderModal({ secondsRemaining: 60 });

    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiry-stay'));
    });

    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('calls the onStaySignedIn callback when provided', async () => {
    const onStay = jest.fn().mockResolvedValue(undefined);
    renderModal({ secondsRemaining: 60, onStaySignedIn: onStay });

    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiry-stay'));
    });

    expect(onStay).toHaveBeenCalledTimes(1);
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it('cancels the auto-logout timer when "Stay signed in" is clicked', async () => {
    const onLoggedOut = jest.fn();
    renderModal({ secondsRemaining: 5, onLoggedOut });

    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiry-stay'));
    });

    // Advance past the original expiry — logout should NOT have been called
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    await Promise.resolve();

    expect(mockLogout).not.toHaveBeenCalled();
    expect(onLoggedOut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Sign out now
// ---------------------------------------------------------------------------

describe('"Sign out now" button', () => {
  it('calls logout and onLoggedOut when clicked', async () => {
    const onLoggedOut = jest.fn();
    renderModal({ secondsRemaining: 60, onLoggedOut });

    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiry-sign-out'));
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(onLoggedOut).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Auto-logout at expiry preserves draft
// ---------------------------------------------------------------------------

describe('AC-3: Draft preservation on auto-logout', () => {
  it('saveDraft() persists composer textarea value to sessionStorage', () => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer', 'true');
    textarea.value = 'My unsaved post content';
    document.body.appendChild(textarea);

    saveDraft();

    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBe('My unsaved post content');
    document.body.removeChild(textarea);
  });

  it('loadDraft() returns the previously saved draft', () => {
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, 'Saved draft');
    expect(loadDraft()).toBe('Saved draft');
  });

  it('clearDraft() removes the draft from sessionStorage', () => {
    sessionStorage.setItem(COMPOSER_DRAFT_KEY, 'Draft');
    clearDraft();
    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it('saveDraft() does nothing when the composer is empty', () => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer', 'true');
    textarea.value = '   '; // whitespace only
    document.body.appendChild(textarea);

    saveDraft();

    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
    document.body.removeChild(textarea);
  });

  it('saveDraft() is called before logout on auto-expiry', async () => {
    // Plant unsaved content in a composer textarea
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer', 'true');
    textarea.value = 'Work in progress';
    document.body.appendChild(textarea);

    const onLoggedOut = jest.fn();
    renderModal({ secondsRemaining: 1, onLoggedOut });

    // Advance to trigger auto-logout
    await act(async () => {
      jest.advanceTimersByTime(1_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBe('Work in progress');
    expect(mockLogout).toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('saveDraft() is called before logout on "Sign out now"', async () => {
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-composer', 'true');
    textarea.value = 'Draft content';
    document.body.appendChild(textarea);

    renderModal({ secondsRemaining: 60 });

    await act(async () => {
      fireEvent.click(screen.getByTestId('session-expiry-sign-out'));
    });

    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBe('Draft content');
    document.body.removeChild(textarea);
  });
});
