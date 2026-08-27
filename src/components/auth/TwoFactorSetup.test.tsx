import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TwoFactorSetup } from './TwoFactorSetup';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const MOCK_SETUP_DATA = {
  secret: 'JBSWY3DPEHPK3PXP',
  qrCodeDataUrl: 'data:image/png;base64,MOCK_QR',
  recoveryCodes: [
    'AAAA-1111',
    'BBBB-2222',
    'CCCC-3333',
    'DDDD-4444',
    'EEEE-5555',
    'FFFF-6666',
    'GGGG-7777',
    'HHHH-8888',
  ],
};

const MOCK_VERIFY_DATA = {
  recoveryCodes: MOCK_SETUP_DATA.recoveryCodes,
};

// Default fetch mock — success path
function mockFetchSuccess() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/auth/2fa/setup') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_SETUP_DATA),
      });
    }
    if (url === '/api/auth/2fa/verify-setup') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_VERIFY_DATA),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  });
}

// Helper: render and wait for QR step to be fully loaded
async function renderAndWaitForQR(
  overrides?: Partial<React.ComponentProps<typeof TwoFactorSetup>>,
) {
  const onComplete = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <TwoFactorSetup onComplete={onComplete} onCancel={onCancel} {...overrides} />,
  );
  await screen.findByTestId('qr-code-image');
  return { ...utils, onComplete, onCancel };
}

// Helper: advance from QR to verify step
async function advanceToVerify() {
  const result = await renderAndWaitForQR();
  await userEvent.click(screen.getByTestId('btn-next-to-verify'));
  await screen.findByTestId('step-verify');
  return result;
}

// Helper: advance from verify to recovery step
async function advanceToRecovery() {
  const result = await advanceToVerify();
  const input = screen.getByTestId('verify-code-input');
  await userEvent.type(input, '123456');
  await userEvent.click(screen.getByTestId('btn-verify-submit'));
  await screen.findByTestId('step-recovery');
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('TwoFactorSetup', () => {
  // ── Initial loading ────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('shows a loading spinner before setup data arrives', async () => {
      let resolve: (value: unknown) => void;
      const pending = new Promise((res) => {
        resolve = res;
      });
      global.fetch = vi.fn().mockReturnValue(pending);

      render(<TwoFactorSetup onComplete={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByLabelText('Loading QR code')).toBeInTheDocument();
    });

    it('renders the QR code image after a successful fetch', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      expect(screen.getByTestId('qr-code-image')).toBeInTheDocument();
    });

    it('shows an error message when setup fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ message: 'Server error' }),
      });
      render(<TwoFactorSetup onComplete={vi.fn()} onCancel={vi.fn()} />);
      await screen.findByRole('alert');
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });
  });

  // ── Secret masking ─────────────────────────────────────────────────────────

  describe('secret masking', () => {
    it('masks the secret by default (shows dots)', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      const secretEl = screen.getByTestId('manual-secret');
      expect(secretEl.textContent).toMatch(/^[•\s]+$/);
    });

    it('reveals the plaintext secret when Reveal is clicked', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      await userEvent.click(screen.getByTestId('reveal-toggle'));
      const secretEl = screen.getByTestId('manual-secret');
      // Should contain the actual base32 characters, not dots
      expect(secretEl.textContent).not.toMatch(/^[•\s]+$/);
      expect(secretEl.textContent?.replace(/\s/g, '')).toBe(MOCK_SETUP_DATA.secret);
    });

    it('re-masks the secret when Hide is clicked', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      await userEvent.click(screen.getByTestId('reveal-toggle')); // reveal
      await userEvent.click(screen.getByTestId('reveal-toggle')); // hide again
      const secretEl = screen.getByTestId('manual-secret');
      expect(secretEl.textContent).toMatch(/^[•\s]+$/);
    });
  });

  // ── Step progression ───────────────────────────────────────────────────────

  describe('step progression', () => {
    it('starts on the QR step', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      expect(screen.getByTestId('step-qr')).toBeInTheDocument();
      expect(screen.queryByTestId('step-verify')).not.toBeInTheDocument();
      expect(screen.queryByTestId('step-recovery')).not.toBeInTheDocument();
    });

    it('advances to the verify step when Next is clicked', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      await userEvent.click(screen.getByTestId('btn-next-to-verify'));
      expect(screen.getByTestId('step-verify')).toBeInTheDocument();
      expect(screen.queryByTestId('step-qr')).not.toBeInTheDocument();
    });

    it('returns to QR step when Back is clicked on the verify step', async () => {
      mockFetchSuccess();
      await advanceToVerify();
      await userEvent.click(screen.getByRole('button', { name: /back/i }));
      expect(screen.getByTestId('step-qr')).toBeInTheDocument();
      expect(screen.queryByTestId('step-verify')).not.toBeInTheDocument();
    });

    it('advances to the recovery step after a successful code verification', async () => {
      mockFetchSuccess();
      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      await userEvent.type(input, '123456');
      await userEvent.click(screen.getByTestId('btn-verify-submit'));
      await screen.findByTestId('step-recovery');
      expect(screen.getByTestId('step-recovery')).toBeInTheDocument();
    });

    it('displays recovery codes on the recovery step', async () => {
      mockFetchSuccess();
      await advanceToRecovery();
      const codesList = screen.getByTestId('recovery-codes-list');
      MOCK_SETUP_DATA.recoveryCodes.forEach((code) => {
        expect(codesList).toHaveTextContent(code);
      });
    });

    it('shows all three step indicators', async () => {
      mockFetchSuccess();
      await renderAndWaitForQR();
      const stepList = screen.getByRole('list', { name: /setup steps/i });
      expect(stepList).toHaveTextContent('Scan');
      expect(stepList).toHaveTextContent('Verify');
      expect(stepList).toHaveTextContent('Save codes');
    });
  });

  // ── Invalid code retry ─────────────────────────────────────────────────────

  describe('invalid code retry', () => {
    it('shows an inline error when a short code is submitted', async () => {
      mockFetchSuccess();
      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      // Type only 3 digits, then manually trigger submit via the form
      await userEvent.type(input, '123');
      // The button is disabled for < 6 chars; fire form submit directly
      fireEvent.submit(input.closest('form')!);
      await screen.findByTestId('verify-error');
      expect(screen.getByTestId('verify-error')).toBeInTheDocument();
    });

    it('shows an inline error when the server rejects the code', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/auth/2fa/setup') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_SETUP_DATA) });
        }
        if (url === '/api/auth/2fa/verify-setup') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'Invalid TOTP code' }),
          });
        }
      });

      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      await userEvent.type(input, '000000');
      await userEvent.click(screen.getByTestId('btn-verify-submit'));
      await screen.findByTestId('verify-error');
      expect(screen.getByTestId('verify-error')).toHaveTextContent('Invalid TOTP code');
    });

    it('clears the code input after a failed verification to allow retry', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/auth/2fa/setup') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_SETUP_DATA) });
        }
        if (url === '/api/auth/2fa/verify-setup') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'Bad code' }),
          });
        }
      });

      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input') as HTMLInputElement;
      await userEvent.type(input, '000000');
      await userEvent.click(screen.getByTestId('btn-verify-submit'));
      await screen.findByTestId('verify-error');
      // Input is cleared so the user can type a new code
      expect(input.value).toBe('');
    });

    it('does NOT regenerate the secret after a failed verification', async () => {
      let setupCallCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/auth/2fa/setup') {
          setupCallCount++;
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_SETUP_DATA) });
        }
        if (url === '/api/auth/2fa/verify-setup') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'Bad code' }),
          });
        }
      });

      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      await userEvent.type(input, '000000');
      await userEvent.click(screen.getByTestId('btn-verify-submit'));
      await screen.findByTestId('verify-error');

      // /api/auth/2fa/setup must only have been called once (at mount)
      expect(setupCallCount).toBe(1);
    });

    it('clears the error message when the user starts typing a new code', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/auth/2fa/setup') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_SETUP_DATA) });
        }
        if (url === '/api/auth/2fa/verify-setup') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'Bad code' }),
          });
        }
      });

      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      await userEvent.type(input, '000000');
      await userEvent.click(screen.getByTestId('btn-verify-submit'));
      await screen.findByTestId('verify-error');

      // Start typing a new code — error should clear
      await userEvent.type(input, '1');
      expect(screen.queryByTestId('verify-error')).not.toBeInTheDocument();
    });

    it('does not advance to recovery when fewer than 6 digits are submitted', async () => {
      mockFetchSuccess();
      await advanceToVerify();
      const input = screen.getByTestId('verify-code-input');
      await userEvent.type(input, '123'); // only 3 digits
      // fire submit via form since button is disabled for < 6 chars
      fireEvent.submit(input.closest('form')!);
      expect(screen.getByTestId('step-verify')).toBeInTheDocument();
    });
  });

  // ── Close blocked before confirmation ─────────────────────────────────────

  describe('close blocked before recovery-code confirmation', () => {
    it('renders the Finish button disabled when checkbox is unchecked', async () => {
      mockFetchSuccess();
      await advanceToRecovery();
      expect(screen.getByTestId('btn-finish')).toBeDisabled();
    });

    it('enables the Finish button once the saved-confirmation checkbox is checked', async () => {
      mockFetchSuccess();
      await advanceToRecovery();
      await userEvent.click(screen.getByTestId('confirm-saved-checkbox'));
      expect(screen.getByTestId('btn-finish')).not.toBeDisabled();
    });

    it('does NOT call onComplete when Finish is clicked with checkbox unchecked', async () => {
      mockFetchSuccess();
      const { onComplete } = await advanceToRecovery();
      await userEvent.click(screen.getByTestId('btn-finish'));
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('calls onComplete when Finish is clicked after confirming recovery codes saved', async () => {
      mockFetchSuccess();
      const { onComplete } = await advanceToRecovery();
      await userEvent.click(screen.getByTestId('confirm-saved-checkbox'));
      await userEvent.click(screen.getByTestId('btn-finish'));
      expect(onComplete).toHaveBeenCalledOnce();
    });

    it('hides the cancel/close button on the recovery step', async () => {
      mockFetchSuccess();
      await advanceToRecovery();
      expect(screen.queryByLabelText('Cancel setup')).not.toBeInTheDocument();
    });
  });

  // ── Cancel behaviour ───────────────────────────────────────────────────────

  describe('cancel behaviour', () => {
    it('calls onCancel when the ✕ button is clicked on the QR step', async () => {
      mockFetchSuccess();
      const { onCancel } = await renderAndWaitForQR();
      await userEvent.click(screen.getByLabelText('Cancel setup'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel when cancel is clicked on the verify step', async () => {
      mockFetchSuccess();
      const { onCancel } = await advanceToVerify();
      await userEvent.click(screen.getByLabelText('Cancel setup'));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  // ── Recovery code actions ──────────────────────────────────────────────────

  describe('recovery code actions', () => {
    it('renders copy and download buttons', async () => {
      mockFetchSuccess();
      await advanceToRecovery();
      expect(screen.getByTestId('btn-copy-codes')).toBeInTheDocument();
      expect(screen.getByTestId('btn-download-codes')).toBeInTheDocument();
    });

    it('calls navigator.clipboard.writeText when Copy is clicked', async () => {
      mockFetchSuccess();
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        configurable: true,
      });

      await advanceToRecovery();
      await userEvent.click(screen.getByTestId('btn-copy-codes'));
      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(MOCK_SETUP_DATA.recoveryCodes.join('\n'));
      });
    });
  });
});
