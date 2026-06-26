import { ttsService } from '../TTSService';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../lib/eventBus', () => ({
  eventBus: { emitJobProgress: jest.fn() },
}));

jest.mock('fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../AudioMerger', () => ({
  audioMerger: {
    mergeAudioFiles: jest.fn().mockResolvedValue(undefined),
    mergeAudioIntoVideo: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const { createLogger } = jest.requireMock('../../lib/logger') as {
  createLogger: () => { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
};
const loggerInstance = createLogger();

const BASE_REQUEST = {
  segments: [{ text: 'hello world' }],
  provider: 'elevenlabs' as const,
};

function waitMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

beforeEach(() => jest.clearAllMocks());

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TTSService #1030 — failure state persistence', () => {
  it('marks job as failed and logs when processJob rejects', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    // Make fetch reject so synthesiseElevenLabs throws
    global.fetch = jest.fn().mockRejectedValue(new Error('ElevenLabs down'));

    const jobId = await ttsService.createJob(BASE_REQUEST);
    await waitMicrotasks();

    const job = ttsService.getJob(jobId);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBeDefined();
    expect(loggerInstance.error).toHaveBeenCalledWith(
      expect.stringContaining(jobId),
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });

  it('logs a second error when updateStatus itself rejects', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('network failure'));

    // Spy on the private updateStatus by observing jobs map
    const jobId = await ttsService.createJob(BASE_REQUEST);

    // Patch the jobs map so getJob returns undefined → updateStatus no-ops (won't throw naturally).
    // Instead we simulate a rejection by replacing updateStatus via prototype.
    const proto = Object.getPrototypeOf(ttsService) as { updateStatus?: jest.Mock };
    const original = proto.updateStatus?.bind(ttsService);
    proto.updateStatus = jest.fn().mockRejectedValue(new Error('DB write failed'));

    const jobId2 = await ttsService.createJob(BASE_REQUEST);
    await waitMicrotasks();

    expect(loggerInstance.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to persist failure status'),
      expect.objectContaining({ statusErr: expect.any(Error) }),
    );

    // Restore
    proto.updateStatus = original as jest.Mock;
  });

  it('getJob returns failed status after processJob rejects', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const jobId = await ttsService.createJob(BASE_REQUEST);
    await waitMicrotasks();

    const job = ttsService.getJob(jobId);
    expect(job?.status).toBe('failed');
  });
});
