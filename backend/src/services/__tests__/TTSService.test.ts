/**
 * #1023 — TTSService unit tests
 *
 * Covers:
 * - createJob persists a pending status row
 * - successful processing transitions status to completed
 * - failed processing transitions status to failed with error message persisted
 *   (pins the .catch() handler behaviour at line ~42)
 */

// ── Prisma mock (auto-mapped by Jest config) ──────────────────────────────────
import { prisma } from '../../lib/prisma';

const mockPrisma = prisma as unknown as {
  tTSJob: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
};

// Populate the empty proxy that the unit project injects
mockPrisma.tTSJob = {
  create: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
};

// ── Stub out heavy side-effects ───────────────────────────────────────────────
jest.mock('../../lib/eventBus', () => ({
  eventBus: { emitJobProgress: jest.fn() },
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../AudioMerger', () => ({
  audioMerger: {
    mergeAudioFiles: jest.fn().mockResolvedValue(undefined),
    mergeAudioIntoVideo: jest.fn().mockResolvedValue(undefined),
  },
}));

// ── TTS config ────────────────────────────────────────────────────────────────
jest.mock('../../config/tts.config', () => ({
  ttsConfig: {
    outputDir: 'tts-output',
    voices: [],
    defaults: { maxSegmentLength: 5000, stability: 0.5, similarityBoost: 0.75, speed: 1.0 },
    elevenlabs: { apiUrl: 'https://api.elevenlabs.io/v1', defaultVoiceId: 'voice-1', model: 'eleven_monolingual_v1' },
    google: { apiUrl: 'https://texttospeech.googleapis.com/v1/text:synthesize', audioEncoding: 'MP3' },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { ttsService } from '../TTSService';

// ── Helpers ───────────────────────────────────────────────────────────────────
const BASE_REQUEST = {
  segments: [{ text: 'Hello world' }],
  userId: 'user-1',
};

function mockJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    status: 'pending',
    progress: 0,
    request: BASE_REQUEST,
    outputAudioPath: null,
    outputVideoPath: null,
    segments: [],
    error: null,
    userId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('TTSService.createJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.GOOGLE_TTS_API_KEY;
  });

  it('throws BadRequestError when segments array is empty', async () => {
    await expect(
      ttsService.createJob({ segments: [], userId: 'u1' }),
    ).rejects.toThrow('At least one text segment is required');
  });

  it('persists a pending status row and returns a job id', async () => {
    // processJob will be called async — make it fail fast so it doesn't linger
    process.env.ELEVENLABS_API_KEY = 'test-key';
    mockPrisma.tTSJob.create.mockResolvedValue(undefined);
    // findUnique returns null so processJob exits early (no job row found)
    mockPrisma.tTSJob.findUnique.mockResolvedValue(null);
    mockPrisma.tTSJob.update.mockResolvedValue(undefined);

    const jobId = await ttsService.createJob(BASE_REQUEST);

    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);

    expect(mockPrisma.tTSJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'pending', progress: 0 }),
      }),
    );
  });

  it('transitions status to failed with error message when processJob throws', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';

    mockPrisma.tTSJob.create.mockResolvedValue(undefined);

    // processJob reads the row, then tries to update to 'processing'
    // We make the row present but let synthesiseElevenLabs fail via fetch
    const row = mockJobRow();
    mockPrisma.tTSJob.findUnique
      .mockResolvedValueOnce(row)      // first call inside processJob
      .mockResolvedValue({ status: 'processing', userId: 'user-1', progress: 0 });

    // Make update resolve so status transitions are recorded
    const updates: Array<Record<string, unknown>> = [];
    mockPrisma.tTSJob.update.mockImplementation(async (args: any) => {
      updates.push(args.data);
      return undefined;
    });

    // Stub global fetch to fail
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('network failure'));

    const jobId = await ttsService.createJob(BASE_REQUEST);

    // Wait for the async processJob to settle (the .catch handler calls updateStatus)
    await new Promise((r) => setTimeout(r, 50));

    global.fetch = origFetch;

    // The .catch handler at line ~42 must have persisted status=failed
    const failedUpdate = updates.find((u) => u.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate?.error).toMatch(/network failure/);
    expect(typeof jobId).toBe('string');
  });

  it('transitions status to completed on a successful processJob run', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';

    mockPrisma.tTSJob.create.mockResolvedValue(undefined);

    const row = mockJobRow();
    mockPrisma.tTSJob.findUnique
      .mockResolvedValueOnce(row)           // processJob initial read
      .mockResolvedValue({ status: 'processing', userId: 'user-1', progress: 50 });

    const updates: Array<Record<string, unknown>> = [];
    mockPrisma.tTSJob.update.mockImplementation(async (args: any) => {
      updates.push(args.data);
      return undefined;
    });

    // Stub ElevenLabs fetch to succeed
    const audioBuffer = Buffer.alloc(1600); // ~100 ms
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => audioBuffer.buffer,
    } as any);

    await ttsService.createJob(BASE_REQUEST);

    // Wait for async processJob
    await new Promise((r) => setTimeout(r, 50));

    global.fetch = origFetch;

    const completedUpdate = updates.find((u) => u.status === 'completed');
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate?.progress).toBe(100);
  });
});

describe('TTSService.getJob', () => {
  it('returns undefined when job does not exist', async () => {
    mockPrisma.tTSJob.findUnique.mockResolvedValue(null);
    const result = await ttsService.getJob('non-existent');
    expect(result).toBeUndefined();
  });

  it('returns the job when it exists', async () => {
    mockPrisma.tTSJob.findUnique.mockResolvedValue(mockJobRow());
    const result = await ttsService.getJob('job-1');
    expect(result?.id).toBe('job-1');
    expect(result?.status).toBe('pending');
  });
});
