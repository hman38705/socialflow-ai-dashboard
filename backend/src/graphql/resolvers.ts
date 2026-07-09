import { GraphQLScalarType, Kind } from 'graphql';
import { PubSub } from 'graphql-subscriptions';
import { prisma } from '../lib/prisma';
import { GraphQLContext } from './context';
import { AuthBlacklistService } from '../services/AuthBlacklistService';

export const pubsub = new PubSub();

const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string',
  serialize: (value) => (value instanceof Date ? value.toISOString() : String(value)),
  parseValue: (value) => new Date(String(value)),
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? new Date(ast.value) : null),
});

/**
 * Throw a standard unauthenticated error when there is no user in context,
 * or when the token has been blacklisted (e.g. after logout).
 */
async function requireAuth(ctx: GraphQLContext): Promise<string> {
  if (!ctx.userId) throw new Error('UNAUTHENTICATED');

  // Guard against valid-but-blacklisted tokens that somehow bypassed buildContext
  if (ctx.tokenKey && (await AuthBlacklistService.isBlacklisted(ctx.tokenKey))) {
    throw new Error('UNAUTHENTICATED');
  }

  return ctx.userId;
}

/**
 * Require the authenticated user to have the 'admin' role.
 * Throws FORBIDDEN if the user is authenticated but not an admin.
 */
async function requireAdmin(ctx: GraphQLContext): Promise<string> {
  const userId = await requireAuth(ctx);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'admin') throw new Error('FORBIDDEN');
  return userId;
}

export const resolvers = {
  DateTime: DateTimeScalar,

  Query: {
    /** Return the currently authenticated user. */
    me: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = await requireAuth(ctx);
      return prisma.user.findUnique({ where: { id: userId } });
    },

    /** Return a single user by ID (admin only). */
    user: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      await requireAdmin(ctx);
      return prisma.user.findUnique({ where: { id } });
    },

    /** Return all posts for an organisation, newest first. */
    posts: async (
      _: unknown,
      { organizationId }: { organizationId: string },
      ctx: GraphQLContext,
    ) => {
      await requireAuth(ctx);
      return prisma.post.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
    },

    /** Return a single post by ID. */
    post: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      await requireAuth(ctx);
      return prisma.post.findUnique({ where: { id } });
    },
  },

  /**
   * Field-level authorization for User.
   * email and role are sensitive — only the owner or an admin may read them.
   */
  User: {
    email: async (parent: { id: string; email: string }, _: unknown, ctx: GraphQLContext) => {
      const userId = await requireAuth(ctx);
      const viewer = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (userId !== parent.id && viewer?.role !== 'admin') throw new Error('FORBIDDEN');
      return parent.email;
    },
    role: async (parent: { id: string; role: string }, _: unknown, ctx: GraphQLContext) => {
      const userId = await requireAuth(ctx);
      const viewer = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (userId !== parent.id && viewer?.role !== 'admin') throw new Error('FORBIDDEN');
      return parent.role;
    },
  },

  Mutation: {
    /** Create a new post for an organisation. */
    createPost: async (
      _: unknown,
      {
        input,
      }: {
        input: { organizationId: string; content: string; platform: string; scheduledAt?: Date };
      },
      ctx: GraphQLContext,
    ) => {
      await requireAuth(ctx);
      return prisma.post.create({ data: input });
    },

    /** Update an existing post. */
    updatePost: async (
      _: unknown,
      {
        id,
        input,
      }: { id: string; input: { content?: string; platform?: string; scheduledAt?: Date } },
      ctx: GraphQLContext,
    ) => {
      await requireAuth(ctx);
      return prisma.post.update({ where: { id }, data: input });
    },

    /** Delete a post. Returns true on success. */
    deletePost: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      await requireAuth(ctx);
      await prisma.post.delete({ where: { id } });
      return true;
    },
  },

  Subscription: {
    /**
     * Subscribe to org-level update events.
     * Topic format: `orgUpdate:<orgId>`.
     * Validates the subscriber belongs to the requested org before forwarding
     * events — prevents cross-org event leakage.
     */
    orgUpdate: {
      subscribe: async (_: unknown, { orgId }: { orgId: string }, ctx: GraphQLContext) => {
        await requireAuth(ctx);

        const membership = await prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: ctx.userId! } },
          select: { organizationId: true },
        });

        if (!membership) {
          throw new Error('FORBIDDEN');
        }

        return pubsub.asyncIterableIterator(`orgUpdate:${orgId}`);
      },
    },
  },
};
