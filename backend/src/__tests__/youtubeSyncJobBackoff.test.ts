/**
 * #1121 — youtubeSyncJob should delay retries until the YouTube quota reset
 * window (YouTubeQuotaError.retryAfter), not the default exponential backoff.
 */
import { Job } from 'bullmq';
import { computeYoutubeBackoffDelay } from '../jobs/youtubeSyncJob';
import { YouTubeQuotaError } from '../services/YouTubeService';

describe('computeYoutubeBackoffDelay', () => {
  it('delays until YouTubeQuotaError.retryAfter instead of using exponential backoff', () => {
    const retryAfter = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours from now
    const err = new YouTubeQuotaError(retryAfter);

    const delay = computeYoutubeBackoffDelay(2, 'custom', err, {} as Job);

    expect(delay).toBeGreaterThan(0);
    // Should match the retryAfter window, not 2^2 * 1000ms exponential backoff
    expect(delay).toBeGreaterThan(2 * 60 * 60 * 1000);
    expect(delay).toBeLessThanOrEqual(3 * 60 * 60 * 1000);
  });

  it('never returns a negative delay once retryAfter has already passed', () => {
    const retryAfter = new Date(Date.now() - 1000);
    const err = new YouTubeQuotaError(retryAfter);

    const delay = computeYoutubeBackoffDelay(1, 'custom', err, {} as Job);

    expect(delay).toBe(0);
  });

  it('falls back to capped exponential backoff for non-quota errors', () => {
    const delay = computeYoutubeBackoffDelay(3, 'custom', new Error('network blip'), {} as Job);

    expect(delay).toBe(8000); // 2^3 * 1000ms
  });

  it('caps exponential fallback delay at 60s', () => {
    const delay = computeYoutubeBackoffDelay(10, 'custom', new Error('network blip'), {} as Job);

    expect(delay).toBe(60_000);
  });
});
