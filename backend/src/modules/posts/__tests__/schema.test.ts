import { createPostSchema } from '../schema';

describe('createPostSchema', () => {
  describe('valid input', () => {
    it('accepts a fully populated valid payload', () => {
      const result = createPostSchema.safeParse({
        title: 'Hello world',
        content: 'This is a valid post body.',
        authorId: 'user-123',
      });

      expect(result.success).toBe(true);
    });

    it('accepts a minimal valid payload', () => {
      const result = createPostSchema.safeParse({
        title: 'Hi',
        content: 'ok',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('missing required fields', () => {
    it('rejects an empty object', () => {
      const result = createPostSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejects a payload missing the title', () => {
      const result = createPostSchema.safeParse({
        content: 'Body without a title.',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a payload missing the content', () => {
      const result = createPostSchema.safeParse({
        title: 'Title without content',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('invalid field values', () => {
    it('rejects an empty title', () => {
      const result = createPostSchema.safeParse({
        title: '',
        content: 'Valid content.',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an empty content body', () => {
      const result = createPostSchema.safeParse({
        title: 'Valid title',
        content: '',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an oversized title', () => {
      const result = createPostSchema.safeParse({
        title: 'a'.repeat(10_000),
        content: 'Valid content.',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an oversized content body', () => {
      const result = createPostSchema.safeParse({
        title: 'Valid title',
        content: 'a'.repeat(1_000_000),
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-string field values', () => {
      const result = createPostSchema.safeParse({
        title: 123,
        content: { nested: true },
      });

      expect(result.success).toBe(false);
    });
  });
});
