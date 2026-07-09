/**
 * PredictiveService tests
 *
 * PredictiveService is a thin API client — all scoring/ML logic lives in
 * backend/src/services/PredictiveService.ts. These tests mock the HTTP
 * layer (`request`) and verify the client calls the right endpoint with
 * the right payload, and passes the response through unchanged.
 */

const mockRequest = jest.fn();

jest.mock('../../api/core/request', () => ({
  request: (...args: unknown[]) => mockRequest(...args),
}));

import { predictiveService } from '../PredictiveService';
import { PostAnalysisInput, ReachPrediction, MLModelMetrics } from '../../types/predictive';

function makePrediction(overrides: Partial<ReachPrediction> = {}): ReachPrediction {
  return {
    reachScore: 72,
    estimatedReach: { min: 100, max: 500, expected: 300 },
    confidence: 0.8,
    factors: [],
    recommendations: ['Add more hashtags'],
    ...overrides,
  };
}

describe('PredictiveService', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  describe('predictReach', () => {
    it('calls POST /predictive/reach with the post input and returns the prediction', async () => {
      const input: PostAnalysisInput = {
        content: 'Test post content',
        platform: 'instagram',
      };
      const prediction = makePrediction();
      mockRequest.mockResolvedValue(prediction);

      const result = await predictiveService.predictReach(input);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: 'POST',
          url: '/predictive/reach',
          body: expect.objectContaining({ content: 'Test post content', platform: 'instagram' }),
        }),
      );
      expect(result).toEqual(prediction);
    });

    it('serialises scheduledTime to an ISO string in the request body', async () => {
      const scheduledTime = new Date('2025-01-01T12:00:00.000Z');
      const input: PostAnalysisInput = {
        content: 'Scheduled post',
        platform: 'tiktok',
        scheduledTime,
      };
      mockRequest.mockResolvedValue(makePrediction());

      await predictiveService.predictReach(input);

      const callArg = mockRequest.mock.calls[0][1];
      expect(callArg.body.scheduledTime).toBe(scheduledTime.toISOString());
    });
  });

  describe('batchPredict', () => {
    it('predicts reach for multiple posts and preserves order', async () => {
      const inputs: PostAnalysisInput[] = [
        { content: 'Post 1', platform: 'instagram' },
        { content: 'Post 2', platform: 'tiktok' },
        { content: 'Post 3', platform: 'linkedin' },
      ];
      mockRequest
        .mockResolvedValueOnce(makePrediction({ reachScore: 10 }))
        .mockResolvedValueOnce(makePrediction({ reachScore: 20 }))
        .mockResolvedValueOnce(makePrediction({ reachScore: 30 }));

      const predictions = await predictiveService.batchPredict(inputs);

      expect(predictions).toHaveLength(3);
      expect(predictions.map((p) => p.reachScore)).toEqual([10, 20, 30]);
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });

  describe('getModelMetrics', () => {
    it('calls GET /predictive/history/{postId} and returns the metrics', async () => {
      const metrics: MLModelMetrics = {
        accuracy: 0.94,
        lastTrainedAt: new Date('2025-01-01T00:00:00.000Z'),
        sampleSize: 12450,
        version: '2.4.1',
      };
      mockRequest.mockResolvedValue({ metrics });

      const result = await predictiveService.getModelMetrics('post-123');

      expect(mockRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          method: 'GET',
          url: '/predictive/history/{postId}',
          path: { postId: 'post-123' },
        }),
      );
      expect(result.metrics).toEqual(metrics);
    });
  });
});
