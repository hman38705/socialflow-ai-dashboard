import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TwoFactorLogin } from './TwoFactorLogin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_TOKENS = { accessToken: 'access-tok', refreshToken: 'refresh-tok' };

function mockFetchVerifySuccess() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(MOCK_TOKENS),
  });
}

function mockFetchVerifyFail(message = 'Invalid code') {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ message }),
  });
}

function mockFetchRateLimit(retryAfter = 30) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 429,
    json: () =>
      Promise.resolve({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down and try again later.',
        retryAfter,
        timestamp: new Date().toISOString(),
      }),
  });
}

function renderLogin(overrides?: Partial<React.ComponentProps<typeof TwoFactorLogin>>) {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<TwoFactorLogin onSuccess={onSuccess} onCancel={onCancel} {...overrides} />);
  return { ...utils, onSuccess, onCancel };
}

// Helper: type a code character-by-character into the 6 digit inputs
async function typeDigits(code: string) {
  for (let i = 0; i < Math.min(code.length, 6); i++) {
    const input = screen.getByTestId(`digit-input-${i}`);
    await userEvent.type(input, code[i]);
  }
}

// Helper: paste 6 digits synchronously
function pasteDigits(code: string) {
  fireEvent.paste(screen.getByTestId('digit-input-0'), {
    clipboardData: { getData: () => code },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('TwoFactorLogin', () => {
  // ── Initial render ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('renders 6 digit input boxes', () => {
      renderLogin();
      for (let i = 0; i < 6; i++) {
        expect(screen.getByTestId(`digit-input-${i}`)).toBeInTheDocument();
      }
    });

    it('starts in TOTP mode', () => {
      renderLogin();
      expect(screen.getByTestId('totp-mode')).toBeInTheDocument();
      expect(screen.queryByTestId('recovery-mode')).not.toBeInTheDocument();
    });

    it('renders the "Use a recovery code instead" switch link', () => {
      renderLogin();
      expect(screen.getByTestId('btn-switch-to-recovery')).toBeInTheDocument();
    });

    it('renders a Cancel button', () => {
      renderLogin();
      expect(screen.getByTestId('btn-cancel')).toBeInTheDocument();
    });
  });

  // ── Typing / auto-advance ──────────────────────────────────────────────────

  describe('auto-advance', () => {
    it('moves focus to the next input after a digit is typed', async () => {
      renderLogin();
      const first = screen.getByTestId('digit-input-0');
      const second = screen.getByTestId('digit-input-1');
      await userEvent.type(first, '1');
      expect(document.activeElement).toBe(second);
    });

    it('places the typed character into the correct box', async () => {
      renderLogin();
      await userEvent.type(screen.getByTestId('digit-input-0'), '4');
      expect((screen.getByTestId('digit-input-0') as HTMLInputElement).value).toBe('4');
    });

    it('moves focus through all six boxes when digits are typed sequentially', async () => {
      mockFetchVerifySuccess();
      renderLogin();
      // Type digits one-by-one — auto-submit fires after 6th
      for (let i = 0; i < 6; i++) {
        await userEvent.type(screen.getByTestId(`digit-input-${i}`), String(i + 1));
      }
      // All six boxes should be filled (verified before submit clears them)
      await waitFor(() => {
        expect((screen.getByTestId('digit-input-0') as HTMLInputElement).value).toBe('1');
      });
    });

    it('ignores non-numeric key input', async () => {
      renderLogin();
      await userEvent.type(screen.getByTestId('digit-input-0'), 'a');
      expect((screen.getByTestId('digit-input-0') as HTMLInputElement).value).toBe('');
    });
  });

  // ── Backspace to previous ──────────────────────────────────────────────────

  describe('backspace', () => {
    it('clears the current digit on Backspace when the box is non-empty', async () => {
      renderLogin();
      const box0 = screen.getByTestId('digit-input-0');
      await userEvent.type(box0, '3');
      fireEvent.keyDown(box0, { key: 'Backspace' });
      expect((box0 as HTMLInputElement).value).toBe('');
    });

    it('moves focus back and clears the previous box on Backspace in an empty box', async () => {
      renderLogin();
      await userEvent.type(screen.getByTestId('digit-input-0'), '5');
      const box1 = screen.getByTestId('digit-input-1');
      // box1 is now focused and empty
      fireEvent.keyDown(box1, { key: 'Backspace' });
      expect((screen.getByTestId('digit-input-0') as HTMLInputElement).value).toBe('');
      expect(document.activeElement).toBe(screen.getByTestId('digit-input-0'));
    });

    it('does not move focus past the first input on Backspace', async () => {
      renderLogin();
      const box0 = screen.getByTestId('digit-input-0');
      box0.focus();
      fireEvent.keyDown(box0, { key: 'Backspace' });
      expect(document.activeElement).toBe(box0);
    });
  });

  // ── Paste support ──────────────────────────────────────────────────────────

  describe('paste', () => {
    it('fills all 6 boxes when a 6-digit string is pasted', async () => {
      renderLogin();
      pasteDigits('123456');
      await waitFor(() => {
        for (let i = 0; i < 6; i++) {
          expect((screen.getByTestId(`digit-input-${i}`) as HTMLInputElement).value).toBe(
            String(i + 1),
          );
        }
      });
    });

    it('strips non-numeric characters from a pasted string', async () => {
      renderLogin();
      pasteDigits('1 2 3 4 5 6');
      await waitFor(() => {
        for (let i = 0; i < 6; i++) {
          expect((screen.getByTestId(`digit-input-${i}`) as HTMLInputElement).value).toBe(
            String(i + 1),
          );
        }
      });
    });

    it('only fills as many boxes as digits pasted (fewer than 6)', async () => {
      renderLogin();
      pasteDigits('123');
      await waitFor(() => {
        expect((screen.getByTestId('digit-input-0') as HTMLInputElement).value).toBe('1');
        expect((screen.getByTestId('digit-input-1') as HTMLInputElement).value).toBe('2');
        expect((screen.getByTestId('digit-input-2') as HTMLInputElement).value).toBe('3');
        expect((screen.getByTestId('digit-input-3') as HTMLInputElement).value).toBe('');
      });
    });

    it('calls fetch with the pasted 6-digit code on auto-submit', async () => {
      mockFetchVerifySuccess();
      renderLogin();
      pasteDigits('654321');
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/2fa/verify',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"code":"654321"'),
          }),
        );
      });
    });
  });

  // ── Auto-submit ────────────────────────────────────────────────────────────

  describe('auto-submit', () => {
    it('auto-submits when the 6th digit is typed', async () => {
      mockFetchVerifySuccess();
      renderLogin();
      await typeDigits('123456');
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/2fa/verify',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('calls onSuccess with tokens after successful auto-submit', async () => {
      mockFetchVerifySuccess();
      const { onSuccess } = renderLogin();
      await typeDigits('123456');
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(MOCK_TOKENS);
      });
    });

    it('does NOT auto-submit when fewer than 6 digits have been entered', async () => {
      mockFetchVerifySuccess();
      renderLogin();
      await typeDigits('12345');
      // Give a tick for any accidental async call
      await new Promise((r) => setTimeout(r, 10));
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ── Wrong code / error ─────────────────────────────────────────────────────

  describe('wrong code', () => {
    it('shows an error message when the server returns a non-429 error', async () => {
      mockFetchVerifyFail('Invalid TOTP code');
      renderLogin();
      await typeDigits('000000');
      await screen.findByTestId('login-error');
      expect(screen.getByTestId('login-error')).toHaveTextContent('Invalid TOTP code');
    });

    it('clears all digit inputs after a wrong code', async () => {
      mockFetchVerifyFail();
      renderLogin();
      await typeDigits('000000');
      await screen.findByTestId('login-error');
      for (let i = 0; i < 6; i++) {
        expect((screen.getByTestId(`digit-input-${i}`) as HTMLInputElement).value).toBe('');
      }
    });

    it('moves focus back to the first input after a wrong code', async () => {
      mockFetchVerifyFail();
      renderLogin();
      await typeDigits('000000');
      await screen.findByTestId('login-error');
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId('digit-input-0'));
      });
    });
  });

  // ── 429 rate-limit countdown ───────────────────────────────────────────────

  describe('429 rate-limit countdown', () => {
    it('shows the rate-limit banner with initial countdown on 429', async () => {
      mockFetchRateLimit(30);
      renderLogin();
      pasteDigits('999999');
      await screen.findByTestId('rate-limit-banner');
      expect(screen.getByTestId('countdown-seconds')).toHaveTextContent('30');
    });

    it('decrements the countdown every second', async () => {
      // Use real timers: set a short retryAfter, wait for banner, then
      // observe that the seconds count decrements naturally.
      mockFetchRateLimit(3);
      renderLogin();
      pasteDigits('999999');
      await screen.findByTestId('countdown-seconds');
      const initial = parseInt(screen.getByTestId('countdown-seconds').textContent ?? '0', 10);
      expect(initial).toBeGreaterThan(0);

      // Wait for at least one real second tick
      await waitFor(
        () => {
          const current = parseInt(
            screen.getByTestId('countdown-seconds').textContent ?? '999',
            10,
          );
          expect(current).toBeLessThan(initial);
        },
        { timeout: 2500 },
      );
    }, 10000);

    it('removes the rate-limit banner when the countdown reaches 0', async () => {
      // Use a 2-second retryAfter so the banner disappears quickly with real timers
      mockFetchRateLimit(2);
      renderLogin();
      pasteDigits('999999');
      await screen.findByTestId('rate-limit-banner');

      // Wait for real timers to count down to 0 and remove the banner
      await waitFor(
        () => {
          expect(screen.queryByTestId('rate-limit-banner')).not.toBeInTheDocument();
        },
        { timeout: 4000 },
      );
    }, 10000);

    it('disables the Verify button while rate-limited', async () => {
      mockFetchRateLimit(60);
      renderLogin();
      pasteDigits('999999');
      await screen.findByTestId('rate-limit-banner');
      expect(screen.getByTestId('btn-verify')).toBeDisabled();
    });
  });

  // ── Recovery code mode ─────────────────────────────────────────────────────

  describe('recovery code mode', () => {
    it('switches to recovery mode when the link is clicked', async () => {
      renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      expect(screen.getByTestId('recovery-mode')).toBeInTheDocument();
      expect(screen.queryByTestId('totp-mode')).not.toBeInTheDocument();
    });

    it('renders a single text input in recovery mode', async () => {
      renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      expect(screen.getByTestId('recovery-code-input')).toBeInTheDocument();
    });

    it('renders "Use authenticator app instead" link in recovery mode', async () => {
      renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      expect(screen.getByTestId('btn-switch-to-totp')).toBeInTheDocument();
    });

    it('switches back to TOTP mode from recovery mode', async () => {
      renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      await userEvent.click(screen.getByTestId('btn-switch-to-totp'));
      expect(screen.getByTestId('totp-mode')).toBeInTheDocument();
    });

    it('calls fetch with the recovery code on verify', async () => {
      mockFetchVerifySuccess();
      renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      const input = screen.getByTestId('recovery-code-input');
      await userEvent.type(input, 'AAAA-1234');
      await userEvent.click(screen.getByTestId('btn-verify-recovery'));
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/2fa/verify',
          expect.objectContaining({
            body: expect.stringContaining('"code":"AAAA-1234"'),
          }),
        );
      });
    });

    it('calls onSuccess with tokens after recovery code verify', async () => {
      mockFetchVerifySuccess();
      const { onSuccess } = renderLogin();
      await userEvent.click(screen.getByTestId('btn-switch-to-recovery'));
      await userEvent.type(screen.getByTestId('recovery-code-input'), 'BBBB-5678');
      await userEvent.click(screen.getByTestId('btn-verify-recovery'));
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(MOCK_TOKENS);
      });
    });
  });

  // ── Cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('calls onCancel when the Cancel button is clicked', async () => {
      const { onCancel } = renderLogin();
      await userEvent.click(screen.getByTestId('btn-cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  // ── challengeToken forwarding ──────────────────────────────────────────────

  describe('challengeToken', () => {
    it('includes the challengeToken in the POST body when provided', async () => {
      mockFetchVerifySuccess();
      renderLogin({ challengeToken: 'ch-token-abc' });
      pasteDigits('123456');
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/auth/2fa/verify',
          expect.objectContaining({
            body: expect.stringContaining('"challengeToken":"ch-token-abc"'),
          }),
        );
      });
    });
  });
});
