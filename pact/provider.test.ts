/**
 * Provider Contract Verification using Pact V3
 *
 * Verifies that the mock server (acting as the real provider) satisfies
 * every interaction recorded in the generated pact files.
 *
 * Prerequisites:
 *   1. Run consumer tests first to generate pact files:
 *        npm run pact:consumer
 *   2. Start the mock server:
 *        npm run mock:server
 *   3. Then run this suite:
 *        npm run pact:provider
 *
 * In CI, set PACT_BROKER_URL to publish/fetch pacts from the broker instead.
 */

import path from 'path';
import { Verifier } from '@pact-foundation/pact';
import { describe, it, beforeAll, afterAll } from 'vitest';
import http from 'http';

// ---------------------------------------------------------------------------
// Inline provider server (mirrors mock-server.ts without the file dependency)
// so the test is self-contained and doesn't require a separately running process.
// ---------------------------------------------------------------------------

const mockHandlers: Record<string, (method: string, body: unknown) => { status: number; body: unknown }> = {
  '/api/gemini/caption': (_m, body) => {
    const { topic, platform, tone } = body as { topic: string; platform: string; tone: string };
    return { status: 200, body: { caption: `${tone} caption for ${platform}: ${topic} #socialmedia` } };
  },
  '/api/gemini/reply': (_m, _body) => {
    return {
      status: 200,
      body: { replies: ['Thank you for reaching out!', 'We appreciate your message.', 'We will get back to you shortly.'] },
    };
  },
  '/api/webhooks': (method, body) => {
    if (method === 'GET') {
      return {
        status: 200,
        body: [{ id: 'webhook-123', url: 'https://example.com/webhook', isActive: true, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', rotationInProgress: false }],
      };
    }
    const { url } = body as { url: string; secret: string };
    return {
      status: 201,
      body: { id: 'webhook-123', url, isActive: true, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', rotationInProgress: false },
    };
  },
  '/api/webhooks/webhook-123/rotate': (_m, body) => {
    const { newSecret } = body as { newSecret: string };
    return {
      status: 200,
      body: {
        id: 'webhook-123',
        url: 'https://example.com/webhook',
        secret: newSecret,
        oldSecret: 'my-secret-key-1234567890',
        isActive: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        rotationInProgress: true,
        rotationStartedAt: '2024-01-02T00:00:00.000Z',
      },
    };
  },
  '/api/users': (_m, body) => {
    const { email, name } = body as { email: string; name: string };
    return { status: 201, body: { id: 'user-123', email, name, createdAt: '2024-01-01T00:00:00.000Z' } };
  },
  '/api/users/user-123': () => ({
    status: 200,
    body: { id: 'user-123', email: 'user@example.com', name: 'Jane Doe', createdAt: '2024-01-01T00:00:00.000Z' },
  }),
  '/api/posts': (_m, body) => {
    const { platform, content, image, scheduledAt } = body as { platform: string; content: string; image?: string; scheduledAt?: string };
    return {
      status: 201,
      body: { id: 'post-123', platform, content, image, status: 'scheduled', scheduledAt: scheduledAt || new Date().toISOString(), createdAt: '2024-01-01T00:00:00.000Z' },
    };
  },
  '/api/posts/post-123/publish': () => ({
    status: 200,
    body: { id: 'post-123', platform: 'instagram', content: 'Check out our summer sale!', status: 'published', publishedAt: '2024-06-01T10:05:00.000Z' },
  }),
};

function createProviderServer(): http.Server {
  return http.createServer((req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const handler = mockHandlers[url];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found', path: url }));
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      try {
        const body = rawBody ? JSON.parse(rawBody) : {};
        const result = handler(method, body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Provider verification
// ---------------------------------------------------------------------------

const PROVIDER_PORT = 3001;
const PACT_DIR = path.resolve(__dirname, '../pacts');

let server: http.Server;

describe('Provider Contract Verification', () => {
  beforeAll(async () => {
    server = createProviderServer();
    await new Promise<void>((resolve) => server.listen(PROVIDER_PORT, resolve));
    console.log(`Provider server listening on port ${PROVIDER_PORT}`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('satisfies all consumer contracts', async () => {
    const verifier = new Verifier({
      provider: 'socialflow-api',
      providerBaseUrl: `http://localhost:${PROVIDER_PORT}`,
      // Load pact files generated by the consumer tests
      pactUrls: [path.resolve(PACT_DIR, 'socialflow-frontend-socialflow-api.json')],
      // Uncomment to verify from a running Pact Broker instead:
      // brokerUrl: process.env.PACT_BROKER_URL || 'http://localhost:9292',
      // consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],
      publishVerificationResult: false,
      logLevel: 'warn',
    });

    await verifier.verifyProvider();
  }, 60_000);
});
