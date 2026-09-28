import express from 'express';
import request from 'supertest';

jest.mock('../controllers.tts', () => ({
  createTTSJob: jest.fn((_req, res) => res.status(201).json({ id: 'job-1' })),
  getTTSJob: jest.fn((_req, res) => res.status(200).json({ id: 'job-1' })),
  listTTSJobs: jest.fn((_req, res) => res.status(200).json({ jobs: [] })),
  cancelTTSJob: jest.fn((_req, res) => res.status(200).json({ id: 'job-1', status: 'cancelled' })),
  listVoices: jest.fn((_req, res) => res.status(200).json({ voices: [] })),
}));

import * as controllers from '../controllers.tts';
import router from '../routes.tts';

const app = express();
app.use(express.json());
app.use('/tts', router);

const mocked = controllers as jest.Mocked<typeof controllers>;

describe('routes.tts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a TTS job with a valid payload', async () => {
    const res = await request(app)
      .post('/tts/jobs')
      .send({ text: 'Hello world', voiceId: 'voice-1' });

    expect(res.status).toBe(201);
    expect(mocked.createTTSJob).toHaveBeenCalledTimes(1);
  });

  it('rejects a schema-invalid createTTSJob payload', async () => {
    const res = await request(app).post('/tts/jobs').send({});

    expect(res.status).toBe(400);
    expect(mocked.createTTSJob).not.toHaveBeenCalled();
  });

  it('gets a TTS job by id', async () => {
    const res = await request(app).get('/tts/jobs/job-1');

    expect(res.status).toBe(200);
    expect(mocked.getTTSJob).toHaveBeenCalledTimes(1);
  });

  it('lists TTS jobs', async () => {
    const res = await request(app).get('/tts/jobs');

    expect(res.status).toBe(200);
    expect(mocked.listTTSJobs).toHaveBeenCalledTimes(1);
  });

  it('cancels a TTS job', async () => {
    const res = await request(app).post('/tts/jobs/job-1/cancel');

    expect(res.status).toBe(200);
    expect(mocked.cancelTTSJob).toHaveBeenCalledTimes(1);
  });

  it('lists available voices', async () => {
    const res = await request(app).get('/tts/voices');

    expect(res.status).toBe(200);
    expect(mocked.listVoices).toHaveBeenCalledTimes(1);
  });
});
