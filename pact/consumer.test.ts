/**
 * Consumer Contract Tests using Pact V3
 *
 * These tests define the expected interactions between the Frontend (consumer)
 * and the Backend API (provider). Running them generates pact files that the
 * provider can later verify against.
 *
 * Run with: npm run pact:consumer
 */

import path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import type { V3MockServer } from '@pact-foundation/pact';
import { describe, it, expect } from 'vitest';

const { eachLike, string, boolean } = MatchersV3;

const CONSUMER_NAME = 'socialflow-frontend';
const PROVIDER_NAME = 'socialflow-api';
const PACT_DIR = path.resolve(__dirname, '../pacts');

// ---------------------------------------------------------------------------
// Shared provider instance – one mock server for all tests in this file
// ---------------------------------------------------------------------------
const provider = new PactV3({
  consumer: CONSUMER_NAME,
  provider: PROVIDER_NAME,
  dir: PACT_DIR,
  logLevel: 'warn',
});

// ---------------------------------------------------------------------------
// Helper: thin HTTP client that hits the Pact mock server
// ---------------------------------------------------------------------------
async function apiPost(baseUrl: string, endpoint: string, body: unknown) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function apiGet(baseUrl: string, endpoint: string) {
  const res = await fetch(`${baseUrl}${endpoint}`);
  return { status: res.status, body: await res.json() };
}

// ===========================================================================
// Gemini API Contracts
// ===========================================================================

describe('Gemini API – caption generation', () => {
  it('returns a caption for a valid request', async () => {
    await provider
      .given('the Gemini API is available')
      .uponReceiving('a request to generate a caption')
      .withRequest({
        method: 'POST',
        path: '/api/gemini/caption',
        headers: { 'Content-Type': 'application/json' },
        body: {
          topic: string('summer sale'),
          platform: string('instagram'),
          tone: string('professional'),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          caption: string('Summer sale is here! #sale #summer'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(mockServer.url, '/api/gemini/caption', {
          topic: 'summer sale',
          platform: 'instagram',
          tone: 'professional',
        });
        expect(status).toBe(200);
        expect(typeof body.caption).toBe('string');
        expect(body.caption.length).toBeGreaterThan(0);
      });
  });
});

describe('Gemini API – reply generation', () => {
  it('returns an array of quick replies', async () => {
    await provider
      .given('the Gemini API is available')
      .uponReceiving('a request to generate quick replies')
      .withRequest({
        method: 'POST',
        path: '/api/gemini/reply',
        headers: { 'Content-Type': 'application/json' },
        body: {
          conversationHistory: string('Hello, I need help with my order.'),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          replies: eachLike(string('Thank you for reaching out!')),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(mockServer.url, '/api/gemini/reply', {
          conversationHistory: 'Hello, I need help with my order.',
        });
        expect(status).toBe(200);
        expect(Array.isArray(body.replies)).toBe(true);
        expect(body.replies.length).toBeGreaterThan(0);
      });
  });
});

// ===========================================================================
// Webhook API Contracts
// ===========================================================================

describe('Webhook API – create webhook', () => {
  it('creates a webhook and returns the config', async () => {
    await provider
      .given('the Webhook API is available')
      .uponReceiving('a request to create a webhook configuration')
      .withRequest({
        method: 'POST',
        path: '/api/webhooks',
        headers: { 'Content-Type': 'application/json' },
        body: {
          url: string('https://example.com/webhook'),
          secret: string('my-secret-key-1234567890'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('webhook-123'),
          url: string('https://example.com/webhook'),
          isActive: boolean(true),
          createdAt: string('2024-01-01T00:00:00.000Z'),
          updatedAt: string('2024-01-01T00:00:00.000Z'),
          rotationInProgress: boolean(false),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(mockServer.url, '/api/webhooks', {
          url: 'https://example.com/webhook',
          secret: 'my-secret-key-1234567890',
        });
        expect(status).toBe(201);
        expect(typeof body.id).toBe('string');
        expect(body.isActive).toBe(true);
        expect(body.rotationInProgress).toBe(false);
      });
  });
});

describe('Webhook API – list webhooks', () => {
  it('returns an array of webhook configs', async () => {
    await provider
      .given('at least one webhook exists')
      .uponReceiving('a request to list all webhook configurations')
      .withRequest({
        method: 'GET',
        path: '/api/webhooks',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: eachLike({
          id: string('webhook-123'),
          url: string('https://example.com/webhook'),
          isActive: boolean(true),
          createdAt: string('2024-01-01T00:00:00.000Z'),
          updatedAt: string('2024-01-01T00:00:00.000Z'),
          rotationInProgress: boolean(false),
        }),
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiGet(mockServer.url, '/api/webhooks');
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);
        expect(body[0]).toHaveProperty('id');
        expect(body[0]).toHaveProperty('isActive');
      });
  });
});

describe('Webhook API – rotate secret', () => {
  it('starts secret rotation and returns updated config', async () => {
    await provider
      .given('a webhook with id webhook-123 exists')
      .uponReceiving('a request to rotate the webhook secret')
      .withRequest({
        method: 'POST',
        path: '/api/webhooks/webhook-123/rotate',
        headers: { 'Content-Type': 'application/json' },
        body: {
          newSecret: string('new-secret-key-9876543210'),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('webhook-123'),
          url: string('https://example.com/webhook'),
          secret: string('new-secret-key-9876543210'),
          oldSecret: string('my-secret-key-1234567890'),
          isActive: boolean(true),
          createdAt: string('2024-01-01T00:00:00.000Z'),
          updatedAt: string('2024-01-02T00:00:00.000Z'),
          rotationInProgress: boolean(true),
          rotationStartedAt: string('2024-01-02T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(
          mockServer.url,
          '/api/webhooks/webhook-123/rotate',
          { newSecret: 'new-secret-key-9876543210' }
        );
        expect(status).toBe(200);
        expect(body.rotationInProgress).toBe(true);
        expect(typeof body.oldSecret).toBe('string');
        expect(typeof body.rotationStartedAt).toBe('string');
      });
  });
});

// ===========================================================================
// User API Contracts
// ===========================================================================

describe('User API – create user', () => {
  it('creates a user and returns the profile', async () => {
    await provider
      .given('the User API is available')
      .uponReceiving('a request to create a new user')
      .withRequest({
        method: 'POST',
        path: '/api/users',
        headers: { 'Content-Type': 'application/json' },
        body: {
          email: string('user@example.com'),
          name: string('Jane Doe'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('user-123'),
          email: string('user@example.com'),
          name: string('Jane Doe'),
          createdAt: string('2024-01-01T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(mockServer.url, '/api/users', {
          email: 'user@example.com',
          name: 'Jane Doe',
        });
        expect(status).toBe(201);
        expect(typeof body.id).toBe('string');
        expect(body.email).toBe('user@example.com');
      });
  });
});

describe('User API – get user by ID', () => {
  it('returns the user profile', async () => {
    await provider
      .given('a user with id user-123 exists')
      .uponReceiving('a request to get a user by ID')
      .withRequest({
        method: 'GET',
        path: '/api/users/user-123',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('user-123'),
          email: string('user@example.com'),
          name: string('Jane Doe'),
          createdAt: string('2024-01-01T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiGet(mockServer.url, '/api/users/user-123');
        expect(status).toBe(200);
        expect(body.id).toBe('user-123');
        expect(typeof body.email).toBe('string');
      });
  });
});

// ===========================================================================
// Post API Contracts
// ===========================================================================

describe('Post API – create post', () => {
  it('creates a scheduled post', async () => {
    await provider
      .given('the Post API is available')
      .uponReceiving('a request to create a new post')
      .withRequest({
        method: 'POST',
        path: '/api/posts',
        headers: { 'Content-Type': 'application/json' },
        body: {
          platform: string('instagram'),
          content: string('Check out our summer sale!'),
          image: string('https://example.com/image.jpg'),
          scheduledAt: string('2024-06-01T10:00:00.000Z'),
        },
      })
      .willRespondWith({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('post-123'),
          platform: string('instagram'),
          content: string('Check out our summer sale!'),
          image: string('https://example.com/image.jpg'),
          status: string('scheduled'),
          scheduledAt: string('2024-06-01T10:00:00.000Z'),
          createdAt: string('2024-01-01T00:00:00.000Z'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(mockServer.url, '/api/posts', {
          platform: 'instagram',
          content: 'Check out our summer sale!',
          image: 'https://example.com/image.jpg',
          scheduledAt: '2024-06-01T10:00:00.000Z',
        });
        expect(status).toBe(201);
        expect(body.status).toBe('scheduled');
        expect(typeof body.id).toBe('string');
      });
  });
});

describe('Post API – publish post', () => {
  it('publishes a scheduled post', async () => {
    await provider
      .given('a scheduled post with id post-123 exists')
      .uponReceiving('a request to publish a post')
      .withRequest({
        method: 'POST',
        path: '/api/posts/post-123/publish',
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          id: string('post-123'),
          platform: string('instagram'),
          content: string('Check out our summer sale!'),
          status: string('published'),
          publishedAt: string('2024-06-01T10:05:00.000Z'),
        },
      })
      .executeTest(async (mockServer: V3MockServer) => {
        const { status, body } = await apiPost(
          mockServer.url,
          '/api/posts/post-123/publish',
          {}
        );
        expect(status).toBe(200);
        expect(body.status).toBe('published');
        expect(typeof body.publishedAt).toBe('string');
      });
  });
});
