import { Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { ModerationService } from '../services/ModerationService';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { indexPost, deletePost as deleteSearchPost } from '../services/SearchService';

const logger = createLogger('post-controller');

export async function createPost(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { content, platform, scheduledAt, organizationId, mediaUrls } = req.body as {
      content: string;
      platform: string;
      scheduledAt?: string;
      organizationId: string;
      mediaUrls?: string[];
    };

    // Run moderation before persisting
    let moderation;
    try {
      moderation = await ModerationService.moderate(content);
    } catch (err) {
      logger.error('Moderation check failed', { error: (err as Error).message });
      // Fail open — log the error but don't block the post if the API is down
      moderation = { flagged: false, blocked: false, categories: {}, scores: {} };
    }

    if (moderation.blocked) {
      throw new BadRequestError(
        `Content blocked by moderation policy: ${moderation.reason ?? 'policy violation'}`,
        'CONTENT_BLOCKED',
      );
    }

    const post = await prisma.post.create({
      data: {
        id: randomUUID(),
        organizationId,
        content,
        platform,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        ...(mediaUrls && { mediaUrls }),
      },
    });

    // Fire-and-forget — don't block the response on indexing
    indexPost({
      id: post.id,
      organizationId: post.organizationId,
      content: post.content,
      platform: post.platform,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      createdAt: post.createdAt.toISOString(),
    });

    res.status(201).json({
      ...post,
      moderation: moderation.flagged
        ? { flagged: true, reason: moderation.reason }
        : { flagged: false },
    });
  } catch (err) {
    next(err);
  }
}

export async function updatePost(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { content, platform, scheduledAt, mediaUrls } = req.body as {
      content?: string;
      platform?: string;
      scheduledAt?: string;
      mediaUrls?: string[];
    };

    const activeOrgId = req.activeOrgId;

    const existing = await prisma.post.findFirst({
      where: { id, organizationId: activeOrgId },
    });

    if (!existing) {
      throw new NotFoundError('Post not found');
    }

    if (content !== undefined) {
      let moderation;
      try {
        moderation = await ModerationService.moderate(content);
      } catch (err) {
        logger.error('Moderation check failed', { error: (err as Error).message });
        moderation = { flagged: false, blocked: false, categories: {}, scores: {} };
      }

      if (moderation.blocked) {
        throw new BadRequestError(
          `Content blocked by moderation policy: ${moderation.reason ?? 'policy violation'}`,
          'CONTENT_BLOCKED',
        );
      }
    }

    const post = await prisma.post.update({
      where: { id },
      data: {
        ...(content !== undefined && { content }),
        ...(platform !== undefined && { platform }),
        ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
        ...(mediaUrls !== undefined && { mediaUrls }),
      },
    });

    res.json(post);
  } catch (err) {
    next(err);
  }
}

export async function deletePost(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const activeOrgId = req.activeOrgId;

    const existing = await prisma.post.findFirst({
      where: { id, organizationId: activeOrgId },
    });

    if (!existing) {
      throw new NotFoundError('Post not found');
    }

    await prisma.post.delete({ where: { id } });

    // Remove from search index (fire-and-forget)
    deleteSearchPost(id);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
