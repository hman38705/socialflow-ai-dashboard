import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { ttsService } from '../services/TTSService';
import { NotFoundError } from '../lib/errors';
import { CreateTTSJobInput } from '../schemas/tts';
import type { TTSProvider } from '../types/tts';

export async function createTTSJob(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = req.body as CreateTTSJobInput;
    const jobId = await ttsService.createJob({
      ...body,
      userId: req.user?.id,
    });
    res.status(202).json({ jobId, status: 'pending' });
  } catch (err) {
    next(err);
  }
}

export async function getTTSJob(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const job = await ttsService.getJob(req.params.jobId);
    if (!job) throw new NotFoundError('TTS job not found');
    res.json(job);
  } catch (err) {
    next(err);
  }
}

export async function listTTSJobs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    res.json(await ttsService.getAllJobs(userId));
  } catch (err) {
    next(err);
  }
}

export async function cancelTTSJob(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const cancelled = await ttsService.cancelJob(req.params.jobId);
    if (!cancelled) throw new NotFoundError('TTS job not found');
    res.json({ message: 'Job cancelled' });
  } catch (err) {
    next(err);
  }
}

export function listVoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const provider = req.query.provider as TTSProvider | undefined;
    const voices = ttsService.getVoices(provider);
    res.json({ voices });
  } catch (err) {
    next(err);
  }
}
