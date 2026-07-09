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
