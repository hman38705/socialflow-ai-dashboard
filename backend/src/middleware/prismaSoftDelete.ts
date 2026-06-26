// Prisma v7 removed Prisma.Middleware from the public API; define params locally.
type MiddlewareParams = {
  model?: string;
  action: string;
  args: any;
  dataPath: string[];
  runInTransaction: boolean;
};

type Next = (params: MiddlewareParams) => Promise<any>;

// Models that support soft delete (have a deletedAt field)
const SOFT_DELETE_MODELS = new Set(['User', 'Listing', 'Post']);

const FIND_MANY_ACTIONS = new Set(['findFirst', 'findMany', 'findFirstOrThrow']);

export const softDeleteMiddleware = async (params: MiddlewareParams, next: Next): Promise<any> => {
  if (!params.model || !SOFT_DELETE_MODELS.has(params.model)) {
    return next(params);
  }

  if (params.action === 'delete') {
    params.action = 'update';
    params.args.data = { deletedAt: new Date() };
    const result = await next(params);
    
    // Remove from search index if deleting a Post
    if (params.model === 'Post' && params.args.where?.id) {
      const { deletePost } = await import('../services/SearchService');
      deletePost(params.args.where.id).catch((err) => {
        console.error('Failed to remove post from search index', { id: params.args.where.id, error: err });
      });
    }
    
    return result;
  }

  if (params.action === 'deleteMany') {
    // Capture IDs before the action is rewritten to updateMany
    let idsToRemove: string[] = [];
    if (params.model === 'Post' && params.args.where) {
      const { prisma: prismaClient } = await import('../lib/prisma');
      const posts = await prismaClient.post.findMany({
        where: params.args.where,
        select: { id: true },
      });
      idsToRemove = posts.map((p: { id: string }) => p.id);
    }

    params.action = 'updateMany';
    params.args.data = { deletedAt: new Date() };
    const result = await next(params);

    if (idsToRemove.length > 0) {
      const { getMeiliClient } = await import('../lib/meilisearch');
      getMeiliClient()
        .index('posts')
        .deleteDocuments(idsToRemove)
        .catch((err: Error) => {
          console.error('Failed to remove posts from search index', { count: idsToRemove.length, error: err });
        });
    }

    return result;
  }

  // findUnique/findUniqueOrThrow only accept unique fields in `where`, so we
  // rewrite them to findFirst/findFirstOrThrow and add the deletedAt filter.
  if (params.action === 'findUnique') {
    params.action = 'findFirst';
    params.args ??= {};
    params.args.where ??= {};
    params.args.where.deletedAt = null;
    return next(params);
  }

  if (params.action === 'findUniqueOrThrow') {
    params.action = 'findFirstOrThrow';
    params.args ??= {};
    params.args.where ??= {};
    params.args.where.deletedAt = null;
    return next(params);
  }

  if (FIND_MANY_ACTIONS.has(params.action)) {
    params.args ??= {};
    params.args.where ??= {};
    params.args.where.deletedAt = null;
    return next(params);
  }

  return next(params);
};
