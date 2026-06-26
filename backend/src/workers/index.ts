/**
 * src/workers/index.ts
 *
 * Worker entry point for AI generation and social posting queues.
 * Each worker runs in the same process as the server; for horizontal
 * scaling, this file can be run as a standalone process via:
 *   node -r ts-node/register src/workers/index.ts
 */
import '../tracing'; // must be first — patches BullMQ and Prisma before they load
import { Job, Worker } from 'bullmq';
import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { queueManager } from '../queues/queueManager';
import { AI_QUEUE_NAME, AIJobData, AIJobType } from '../queues/aiQueue';
import { SOCIAL_QUEUE_NAME, SocialJobData, SocialJobType } from '../queues/socialQueue';
import { restoreTraceContext } from '../lib/traceContext';
import { aiService } from '../services/AIService';
import { translationService } from '../services/TranslationService';
import { prisma } from '../lib/prisma';
import { withTransaction, TxClient } from '../lib/transaction';
import { createLogger } from '../lib/logger';
import { twitterService } from '../services/TwitterService';
import { linkedInService } from '../services/LinkedInService';
import { instagramService } from '../services/InstagramService';
import { tiktokService } from '../services/TikTokService';
import { facebookService } from '../services/FacebookService';
import { ValidationError } from '../lib/errors';
import { billingService } from '../services/BillingService';

const logger = createLogger('workers');

const workerTracer = trace.getTracer('socialflow-workers');

// ── helpers ───────────────────────────────────────────────────────────────────

function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  if (!span) return undefined;
  const id = span.spanContext().traceId;
  return id === '00000000000000000000000000000000' ? undefined : id;
}

/**
 * Run `fn` inside a child span that is linked to the originating HTTP request
 * span via the W3C trace context stored in the job payload.
 *
 * The span is named `<queue>/<jobType>` and carries standard job attributes.
 * On success it is marked OK; on failure it is marked ERROR and the exception
 * is recorded before the error is re-thrown so BullMQ can handle retries.
 */
async function withJobSpan<T>(
  job: Job<AIJobData | SocialJobData>,
  queueName: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Restore the parent context from the serialised trace context in the payload
  const parentCtx = restoreTraceContext(job.data.traceContext);

  return context.with(parentCtx, async () => {
    const span = workerTracer.startSpan(`${queueName}/${job.data.type}`, {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'bullmq',
        'messaging.destination': queueName,
        'messaging.operation': 'process',
        'job.id': job.id ?? '',
        'job.type': job.data.type,
        'job.attempts_made': job.attemptsMade,
        'enduser.id': job.data.userId,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  });
}

async function persistAIResult(
  job: Job<AIJobData>,
  output: Record<string, unknown>,
  tx?: TxClient,
): Promise<void> {
  const client = tx ?? prisma;
  await (client as any).aIGenerationResult.upsert({
    where: { jobId: job.id! },
    update: {},
    create: {
      jobId: job.id!,
      userId: job.data.userId,
      organizationId: job.data.organizationId ?? null,
      jobType: job.data.type,
      output: output as object,
      traceId: currentTraceId() ?? null,
    },
  });
}

// ── AI generation processors ─────────────────────────────────────────────────

const aiProcessors: Record<AIJobType, (job: Job<AIJobData>) => Promise<unknown>> = {
  'generate-caption': async (job) => {
    const { prompt, options, userId } = job.data;
    const platform = (options?.platform as string) ?? 'general';
    const tone = (options?.tone as string) ?? 'professional';
    logger.info('Generating caption', { jobId: job.id, userId });

    const caption = await aiService.generateCaption(prompt, platform, tone);
    const output = { caption, generatedAt: new Date().toISOString() };
    await withTransaction(async (tx) => persistAIResult(job, output, tx));
    return output;
  },

  'generate-hashtags': async (job) => {
    const { prompt, options, userId } = job.data;
    const platform = (options?.platform as string) ?? 'general';
    logger.info('Generating hashtags', { jobId: job.id, userId });

    const { text: raw } = await aiService.generateContent(
      `Generate 5–10 relevant hashtags for a ${platform} post about: "${prompt}". Return only the hashtags, one per line, each starting with #.`,
      `#${platform} #content #update`,
      userId,
    );
    const hashtags = raw
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.startsWith('#'));
    const output = { hashtags, generatedAt: new Date().toISOString() };
    await withTransaction(async (tx) => persistAIResult(job, output, tx));
    return output;
  },

  'generate-content': async (job) => {
    const { prompt, options, userId } = job.data;
    logger.info('Generating content', { jobId: job.id, userId });

    const { text: content } = await aiService.generateContent(prompt, undefined, userId);
    const output = { content, generatedAt: new Date().toISOString() };
    await withTransaction(async (tx) => persistAIResult(job, output, tx));
    return output;
  },

  'analyze-sentiment': async (job) => {
    const { prompt, userId } = job.data;
    logger.info('Analysing sentiment', { jobId: job.id, userId });

    const analysis = await aiService.analyzeContent(prompt);
    const output = { ...analysis, analysedAt: new Date().toISOString() };
    await withTransaction(async (tx) => persistAIResult(job, output, tx));
    return output;
  },

  'translate-content': async (job) => {
    const { prompt, options, userId } = job.data;
    const targetLanguages = (options?.targetLanguages as string[]) ?? ['en'];
    logger.info('Translating content', { jobId: job.id, userId });

    const result = await translationService.translate({
      text: prompt,
      targetLanguages,
      sourceLanguage: (options?.sourceLanguage as string) ?? undefined,
    });
    const output = { ...result, translatedAt: new Date().toISOString() };
    await withTransaction(async (tx) => persistAIResult(job, output, tx));
    return output;
  },
};

// ── Social posting processors ─────────────────────────────────────────────────

/** Extract and validate the access token from job options. */
function requireToken(job: Job<SocialJobData>): string {
  const token = job.data.payload.options?.accessToken as string | undefined;
  if (!token) {
    throw new ValidationError('accessToken is required in payload.options', undefined, 'MISSING_ACCESS_TOKEN');
  }
  return token;
}

const socialProcessors: Record<SocialJobType, (job: Job<SocialJobData>) => Promise<unknown>> = {
  'publish-post': async (job) => {
    const { platform, userId, payload } = job.data;
    logger.info('Publishing post', { jobId: job.id, platform, userId });

    if (!payload.content && !payload.mediaUrls?.length) {
      throw new ValidationError('content or mediaUrls required for publish-post', undefined, 'INVALID_PAYLOAD');
    }

    const token = requireToken(job);

    try {
      switch (platform) {
        case 'twitter': {
          const post = await twitterService.postTweet({ text: payload.content ?? '' });
          return { postId: post.id, platform, publishedAt: post.created_at };
        }
        case 'linkedin': {
          const authorUrn = payload.options?.authorUrn as string;
          if (!authorUrn) throw new ValidationError('authorUrn required for LinkedIn', undefined, 'INVALID_PAYLOAD');
          // Build mediaAssets from mediaUrls when present
          const mediaAssets =
            payload.mediaUrls && payload.mediaUrls.length > 0
              ? payload.mediaUrls.map((url) => ({ url }))
              : undefined;
          const result = await linkedInService.shareContent(token, {
            authorUrn,
            text: payload.content ?? '',
            url: payload.options?.url as string | undefined,
            title: payload.options?.title as string | undefined,
            description: payload.options?.description as string | undefined,
            mediaAssets,
          });
          return { postId: result.id, platform, publishedAt: new Date().toISOString() };
        }
        case 'instagram': {
          const igAccountId = payload.options?.igAccountId as string;
          if (!igAccountId) throw new ValidationError('igAccountId required for Instagram', undefined, 'INVALID_PAYLOAD');
          const result = await instagramService.publish({
            igAccountId,
            accessToken: token,
            mediaType: (payload.options?.mediaType as any) ?? 'IMAGE',
            mediaUrl: payload.mediaUrls?.[0] ?? '',
            caption: payload.content,
          });
          return { postId: result.mediaId, platform, publishedAt: result.publishedAt };
        }
        case 'tiktok': {
          const videoUrl = payload.mediaUrls?.[0];
          if (!videoUrl) throw new ValidationError('mediaUrls[0] required for TikTok video', undefined, 'INVALID_PAYLOAD');
          const result = await tiktokService.uploadVideoFromUrl(token, {
            videoSource: videoUrl,
            sourceType: 'PULL_FROM_URL',
            title: payload.content ?? 'New video',
          });
          return { postId: result.publishId, platform, publishedAt: new Date().toISOString() };
        }
        case 'facebook': {
          const pageId = payload.options?.pageId as string;
          if (!pageId) throw new ValidationError('pageId required for Facebook', undefined, 'INVALID_PAYLOAD');
          if (!payload.content) throw new ValidationError('content required for Facebook', undefined, 'INVALID_PAYLOAD');
          const result = await facebookService.postToPage({
            pageId,
            message: payload.content,
          });
          return { postId: result.id, platform, publishedAt: new Date().toISOString() };
        }
        default:
          throw new ValidationError(`Unsupported platform: ${platform}`, undefined, 'UNSUPPORTED_PLATFORM');
      }
    } catch (err) {
      // Compensating credit refund: credits were deducted before the job was
      // enqueued. If the platform API call fails, restore them so the user is
      // not left short-changed.
      if (userId && billingService.isConfigured()) {
        try {
          billingService.refundCredits(userId, 'post:publish', `platform_failure:${platform}`);
          logger.info('Credits refunded after publish failure', { userId, platform, jobId: job.id });
        } catch (refundErr) {
          // Log but don't mask the original error
          logger.error('Failed to refund credits after publish failure', {
            userId,
            platform,
            jobId: job.id,
            error: (refundErr as Error).message,
          });
        }
      }
      throw err;
    }
  },

  'schedule-post': async (job) => {
    const { platform, userId, payload } = job.data;
    logger.info('Scheduling post', { jobId: job.id, platform, userId, scheduledAt: payload.scheduledAt });

    if (!payload.scheduledAt) {
      throw new ValidationError('scheduledAt is required for schedule-post', undefined, 'INVALID_PAYLOAD');
    }
    if (!payload.content && !payload.mediaUrls?.length) {
      throw new ValidationError('content or mediaUrls required for schedule-post', undefined, 'INVALID_PAYLOAD');
    }

    const token = requireToken(job);
    const scheduledAt = new Date(payload.scheduledAt);

    switch (platform) {
      case 'instagram': {
        const igAccountId = payload.options?.igAccountId as string;
        if (!igAccountId) throw new ValidationError('igAccountId required for Instagram', undefined, 'INVALID_PAYLOAD');
        const result = await instagramService.publish({
          igAccountId,
          accessToken: token,
          mediaType: (payload.options?.mediaType as any) ?? 'IMAGE',
          mediaUrl: payload.mediaUrls?.[0] ?? '',
          caption: payload.content,
          scheduledPublishTime: scheduledAt,
        });
        return { postId: result.mediaId, platform, scheduledAt: payload.scheduledAt };
      }
      // Twitter, LinkedIn, TikTok, Facebook do not have native scheduling via API;
      // BullMQ delayed jobs handle the timing — publish at the scheduled time.
      default: {
        // Re-enqueue as a publish-post job delayed to scheduledAt
        const { enqueueSocialJob } = await import('../queues/socialQueue');
        const jobId = await enqueueSocialJob(
          { ...job.data, type: 'publish-post' },
          job.opts?.priority,
        );
        return { postId: null, platform, scheduledAt: payload.scheduledAt, queuedJobId: jobId };
      }
    }
  },

  'delete-post': async (job) => {
    const { platform, userId, payload } = job.data;
    logger.info('Deleting post', { jobId: job.id, platform, userId, postId: payload.postId });

    if (!payload.postId) {
      throw new ValidationError('postId is required for delete-post', undefined, 'INVALID_PAYLOAD');
    }

    const token = requireToken(job);

    switch (platform) {
      case 'facebook':
      case 'instagram': {
        // Both use the Facebook Graph API for deletion
        const deleted = await facebookService.deleteComment(payload.postId, token);
        return { deleted, platform, postId: payload.postId };
      }
      default:
        // Twitter, LinkedIn, TikTok deletion endpoints require additional
        // OAuth scopes not yet provisioned; log and surface for manual action.
        logger.warn('Delete not yet implemented for platform', { platform, postId: payload.postId });
        return { deleted: false, platform, postId: payload.postId, reason: 'not_implemented' };
    }
  },

  'sync-analytics': async (job) => {
    const { platform, userId } = job.data;
    logger.info('Syncing analytics', { jobId: job.id, platform, userId });
    // Analytics sync is handled by AnalyticsService.sync() on the frontend.
    // This job is a no-op placeholder for server-side triggered syncs.
    return { synced: true, platform, syncedAt: new Date().toISOString() };
  },
};

// ── Worker factory ────────────────────────────────────────────────────────────

function createAIWorker(): Worker<AIJobData> {
  const worker = queueManager.createWorker(
    AI_QUEUE_NAME,
    async (job: Job<AIJobData>) => {
      const processor = aiProcessors[job.data.type];
      if (!processor) {
        throw new Error(`Unknown AI job type: ${job.data.type}`);
      }
      return withJobSpan(job, AI_QUEUE_NAME, () => processor(job));
    },
    { concurrency: 5 }, // AI calls are I/O-bound; 5 concurrent is safe
  ) as Worker<AIJobData>;

  worker.on('failed', (job, err) => {
    logger.error('AI job failed', {
      jobId: job?.id,
      type: job?.data.type,
      userId: job?.data.userId,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts,
      error: err.message,
      movedToDeadLetter: job?.attemptsMade === job?.opts.attempts,
    });
  });

  return worker;
}

function createSocialWorker(): Worker<SocialJobData> {
  const worker = queueManager.createWorker(
    SOCIAL_QUEUE_NAME,
    async (job: Job<SocialJobData>) => {
      const processor = socialProcessors[job.data.type];
      if (!processor) {
        throw new Error(`Unknown social job type: ${job.data.type}`);
      }
      return withJobSpan(job, SOCIAL_QUEUE_NAME, () => processor(job));
    },
    { concurrency: 3 }, // Lower concurrency to respect platform rate limits
  ) as Worker<SocialJobData>;

  worker.on('failed', async (job: Job<SocialJobData> | undefined, err: Error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 3;
    const isFinal = job.attemptsMade >= maxAttempts;

    logger.error('Social posting job failed', {
      jobId: job.id,
      platform: job.data.platform,
      userId: job.data.userId,
      type: job.data.type,
      attemptsMade: job.attemptsMade,
      maxAttempts,
      reason: err.message,
      permanent: isFinal,
    });

    if (isFinal) {
      // Notify the user that their post has permanently failed (exhausted all retries)
      try {
        const { sendInAppNotification } = await import('../queues/notificationQueue');
        await sendInAppNotification(
          job.data.userId,
          'Post failed to publish',
          `Your ${job.data.platform} post could not be published after ${job.attemptsMade} attempt(s): ${err.message}`,
          { jobId: job.id, platform: job.data.platform, type: job.data.type },
          { userId: job.data.userId, priority: 'high' },
        );
      } catch (notifyErr) {
        logger.error('Failed to enqueue failure notification for social job', {
          jobId: job.id,
          userId: job.data.userId,
          error: (notifyErr as Error).message,
        });
      }
    }
  });

  return worker;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function startWorkers(): { ai: Worker<AIJobData>; social: Worker<SocialJobData> } {
  const ai = createAIWorker();
  const social = createSocialWorker();
  logger.info('AI and social workers started', {
    queues: [AI_QUEUE_NAME, SOCIAL_QUEUE_NAME],
  });
  return { ai, social };
}

