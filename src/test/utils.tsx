import React from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { faker } from '@faker-js/faker';
import { vi, type MockInstance } from 'vitest';
import { ToastProvider } from '../contexts/ToastContext';
import { AuthProvider, REFRESH_TOKEN_KEY, EMAIL_KEY } from '../contexts/AuthContext';
import { PostsProvider } from '../contexts/PostsContext';
import { ComposerProvider } from '../contexts/ComposerContext';
import { JobsProvider } from '../contexts/JobsContext';
import { AuthService } from '../api/services/AuthService';
import * as requestModule from '../api/core/request';
import { CancelablePromise } from '../api/core/CancelablePromise';
import type { Post } from '../api/models/Post';
import type { Organization } from '../api/models/Organization';
import type { Subscription } from '../api/models/Subscription';
import type { VideoJob } from '../api/models/VideoJob';
import type { WebhookSubscription } from '../api/models/WebhookSubscription';
import type { WebhookDelivery } from '../api/models/WebhookDelivery';

/**
 * Shared test utilities (FE-006).
 *
 * Every deleted component test used to re-mount ToastProvider, AuthProvider,
 * PostsProvider, ComposerProvider, and JobsProvider by hand. Centralized
 * here — no test should import those providers directly afterwards.
 */

// ── renderWithProviders ─────────────────────────────────────────────────────

export interface RenderWithProvidersOptions {
  /** Initial MemoryRouter entry. Defaults to '/'. */
  route?: string;
  /**
   * 'authenticated' seeds sessionStorage with a refresh token and mocks
   * AuthService.postAuthRefresh to succeed, so AuthProvider's mount-time
   * silent refresh resolves to a signed-in user. 'unauthenticated' (default)
   * clears any session and leaves the refresh call unmocked (it 401s/no-ops
   * because there's no refresh token to send).
   */
  authState?: 'authenticated' | 'unauthenticated';
  /** Seeds PostsContext's initial list fetch with this page of posts. */
  posts?: Post[];
}

export interface RenderWithProvidersResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
}

export function renderWithProviders(
  ui: React.ReactElement,
  { route = '/', authState = 'unauthenticated', posts }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  if (authState === 'authenticated') {
    sessionStorage.setItem(REFRESH_TOKEN_KEY, 'test-refresh-token');
    sessionStorage.setItem(EMAIL_KEY, 'test@example.com');
    vi.spyOn(AuthService, 'postAuthRefresh').mockReturnValue(
      new CancelablePromise((resolve) =>
        resolve({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
      ),
    );
  } else {
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
  }

  if (posts) {
    vi.spyOn(requestModule, 'request').mockReturnValue(
      new CancelablePromise((resolve) =>
        resolve({ data: posts, total: posts.length, page: 1, limit: posts.length, pages: 1 }),
      ),
    );
  }

  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[route]}>
      <ToastProvider>
        <AuthProvider>
          <PostsProvider>
            <ComposerProvider>
              <JobsProvider>{ui}</JobsProvider>
            </ComposerProvider>
          </PostsProvider>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

  return { user, ...utils };
}

// ── mockApi ──────────────────────────────────────────────────────────────────

/**
 * Types a `vi.spyOn(Service, 'method')` mock whose resolved value is wrapped
 * in a real `CancelablePromise` — matching what every generated service
 * method actually returns — instead of a plain Promise, so code that calls
 * `.cancel()` on the result still works against a mock.
 */
export function mockApi<S extends object, M extends keyof S>(
  service: S,
  method: M,
  value: S[M] extends (...args: never[]) => CancelablePromise<infer R> ? R : never,
): MockInstance {
  return vi
    .spyOn(service, method as never)
    .mockReturnValue(new CancelablePromise((resolve) => resolve(value)));
}

// ── Fixture builders ─────────────────────────────────────────────────────────
// Mirror src/api/models — every field optional there, so these fill in a
// complete, realistic object by default and accept overrides for the rest.

export function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: faker.string.uuid(),
    content: faker.lorem.sentence(),
    platform: faker.helpers.arrayElement([
      'twitter',
      'linkedin',
      'instagram',
      'tiktok',
      'facebook',
      'youtube',
    ]),
    organizationId: faker.string.uuid(),
    scheduledAt: null,
    createdAt: faker.date.recent().toISOString(),
    ...overrides,
  };
}

export function buildOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    createdAt: faker.date.past().toISOString(),
    ...overrides,
  };
}

export function buildSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    plan: faker.helpers.arrayElement(['starter', 'pro', 'enterprise']),
    credits: faker.number.int({ min: 0, max: 10000 }),
    status: faker.helpers.arrayElement(['active', 'past_due', 'canceled']),
    ...overrides,
  };
}

export function buildVideoJob(overrides: Partial<VideoJob> = {}): VideoJob {
  return {
    jobId: faker.string.uuid(),
    status: faker.helpers.arrayElement(['pending', 'processing', 'completed', 'failed', 'cancelled']),
    progress: faker.number.int({ min: 0, max: 100 }),
    outputPath: null,
    error: null,
    ...overrides,
  };
}

export function buildWebhookSubscription(
  overrides: Partial<WebhookSubscription> = {},
): WebhookSubscription {
  return {
    id: faker.string.uuid(),
    url: faker.internet.url(),
    events: [faker.helpers.arrayElement(['post.published', 'video.completed', 'subscription.updated'])],
    isActive: true,
    createdAt: faker.date.past().toISOString(),
    updatedAt: faker.date.recent().toISOString(),
    ...overrides,
  };
}

export function buildWebhookDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: faker.string.uuid(),
    eventType: faker.helpers.arrayElement(['post.published', 'video.completed', 'subscription.updated']),
    status: faker.helpers.arrayElement(['pending', 'success', 'failed']),
    attempts: faker.number.int({ min: 0, max: 5 }),
    responseStatus: faker.helpers.arrayElement([200, 404, 500, null]),
    errorMessage: null,
    createdAt: faker.date.recent().toISOString(),
    nextRetryAt: null,
    ...overrides,
  };
}

export { faker };
