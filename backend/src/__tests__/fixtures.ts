/**
 * Shared test fixtures for backend integration tests.
 *
 * Provides helpers for creating users with roles and generating signed JWTs
 * so individual test files don't repeat the same boilerplate.
 */

import jwt from 'jsonwebtoken';
import { RoleStore } from '../models/Role';

export type TestRole = 'admin' | 'editor' | 'viewer';

export interface TestUser {
  userId: string;
  role: TestRole;
  /** Pre-signed JWT valid for 15 minutes */
  token: string;
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

/**
 * Generate a signed JWT for the given user ID.
 * Uses the same secret and expiry as the app under test.
 */
export function generateTestToken(userId: string, expiresIn = '15m'): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn } as jwt.SignOptions);
}

/**
 * Register a user in RoleStore and return a TestUser with a pre-signed token.
 *
 * @param userId  Unique identifier (defaults to `<role>-fixture-<random>`)
 * @param role    Role to assign
 */
export function createTestUser(role: TestRole, userId?: string): TestUser {
  const id = userId ?? `${role}-fixture-${Math.random().toString(36).slice(2, 8)}`;
  RoleStore.assign(id, role);
  return { userId: id, role, token: generateTestToken(id) };
}

/**
 * Build a response body that mixes ASCII and multibyte characters so that a
 * fixed-length character truncation is guaranteed to land inside a multibyte
 * character or surrogate pair.
 *
 * The returned string contains emoji (surrogate pairs) and CJK characters
 * (BMP multibyte) interleaved with ASCII so tests can exercise the truncation
 * boundary deterministically.
 *
 * @param length  Minimum number of characters the body should contain
 */
export function createMultibyteBody(length = 64): string {
  const seed = 'a\u{1F600}\u4F60\u597D\u{1F680}b\u00E9\u{1F4A9}\u3053\u3093';
  let body = '';
  while (body.length < length) {
    body += seed;
  }
  return body;
}

/**
 * Detect whether a string contains a lone (unpaired) surrogate code unit.
 * A valid string produced by truncation must never contain one.
 */
export function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
