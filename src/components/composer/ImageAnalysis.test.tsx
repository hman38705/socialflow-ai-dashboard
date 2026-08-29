import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageAnalysis } from './ImageAnalysis';
import { AiService } from '../../api/services/AiService';

vi.mock('../../api/services/AiService', () => ({
  AiService: { postAiAnalyzeImage: vi.fn() },
}));

const mockedAnalyze = vi.mocked(AiService.postAiAnalyzeImage);

describe('ImageAnalysis', () => {
  beforeEach(() => {
    mockedAnalyze.mockReset();
  });

  it('is opt-in: does not call the API until the user clicks Analyze', () => {
    render(<ImageAnalysis imageData="data:image/png;base64,AAA" onApplyAltText={vi.fn()} />);
    expect(mockedAnalyze).not.toHaveBeenCalled();
    expect(screen.getByText('Analyze image')).toBeInTheDocument();
  });

  it('applies the suggested alt text on one click', async () => {
    mockedAnalyze.mockResolvedValueOnce({ caption: 'A sunset over the mountains' } as Awaited<
      ReturnType<typeof AiService.postAiAnalyzeImage>
    >);
    const onApplyAltText = vi.fn();
    render(<ImageAnalysis imageData="data:image/png;base64,AAA" onApplyAltText={onApplyAltText} />);

    fireEvent.click(screen.getByText('Analyze image'));
    await waitFor(() => expect(screen.getByText('Use as alt text')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Use as alt text'));
    expect(onApplyAltText).toHaveBeenCalledWith('A sunset over the mountains');
  });

  it('surfaces a non-blocking error on failure, with a retry affordance', async () => {
    mockedAnalyze.mockRejectedValueOnce(new Error('AI processing error'));
    render(<ImageAnalysis imageData="data:image/png;base64,AAA" onApplyAltText={vi.fn()} />);

    fireEvent.click(screen.getByText('Analyze image'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
