import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AiAssistPanel } from './AiAssistPanel';
import { runAiAssist } from '../../services/aiContentAssistService';

vi.mock('../../services/aiContentAssistService', async () => {
  const actual = await vi.importActual<typeof import('../../services/aiContentAssistService')>(
    '../../services/aiContentAssistService',
  );
  return { ...actual, runAiAssist: vi.fn() };
});

const mockedRunAiAssist = vi.mocked(runAiAssist);

describe('AiAssistPanel', () => {
  beforeEach(() => {
    mockedRunAiAssist.mockReset();
  });

  it('accept flow calls onAccept with the suggestion', async () => {
    mockedRunAiAssist.mockResolvedValueOnce({ suggestions: ['Better caption!'] });
    const onAccept = vi.fn();
    render(<AiAssistPanel text="hello" onAccept={onAccept} />);

    fireEvent.click(screen.getByText('Improve'));
    await waitFor(() => expect(screen.getByText('Better caption!')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Accept'));
    expect(onAccept).toHaveBeenCalledWith('Better caption!');
  });

  it('reject flow discards the suggestion and never touches the text', async () => {
    mockedRunAiAssist.mockResolvedValueOnce({ suggestions: ['Discard me'] });
    const onAccept = vi.fn();
    render(<AiAssistPanel text="hello" onAccept={onAccept} />);

    fireEvent.click(screen.getByText('Shorten'));
    await waitFor(() => expect(screen.getByText('Discard me')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Reject'));
    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard me')).not.toBeInTheDocument();
  });

  it('the Stop button aborts the in-flight request', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockedRunAiAssist.mockImplementationOnce(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          capturedSignal = options?.signal;
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const onAccept = vi.fn();
    render(<AiAssistPanel text="hello" onAccept={onAccept} />);

    fireEvent.click(screen.getByText('Generate variations'));
    await waitFor(() => expect(screen.getByText('Stop')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
