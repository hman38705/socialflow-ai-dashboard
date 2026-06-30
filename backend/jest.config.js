// Jest resolves this file in preference to jest.config.json.
// Top-level keys (preset, testEnvironment, etc.) are intentionally omitted
// here because Jest ignores them when `projects` is defined — each project
// carries its own settings.

const sharedModuleNameMapper = {
  '^uuid$': '<rootDir>/src/__tests__/integration/__mocks__/uuid.js',
  '^.*/services/geminiService$':
    '<rootDir>/src/__tests__/integration/__mocks__/geminiService.js',
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
    '!src/tracing.ts',
  ],
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { lines: 80, statements: 80, functions: 80, branches: 70 },
  },
  projects: [
    {
      displayName: 'gemini-validation',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/geminiImageValidation.test.ts'],
      moduleNameMapper: {
        '^uuid$': '<rootDir>/src/__tests__/integration/__mocks__/uuid.js',
        '^opossum$': '<rootDir>/src/__tests__/__mocks__/opossum.ts',
        '^.*/lib/prisma$': '<rootDir>/src/__tests__/__mocks__/prisma.ts',
        '^.*/lib/logger$': '<rootDir>/src/__tests__/__mocks__/logger.ts',
      },
      setupFiles: ['<rootDir>/src/__tests__/unitSetup.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/otelTeardown.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
    },
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: [
        '**/__tests__/*.test.ts',
        '**/tests/**/*.test.ts',
        '**/services/__tests__/**/*.test.ts',
        '!**/services/__tests__/CircuitBreakerService.integration.test.ts',
        '!**/__tests__/geminiImageValidation.test.ts',
        '!**/services/__tests__/AIService.circuitBreaker.test.ts',
        // LockServiceUnit exercises the real LockService implementation and
        // must run in its own project without the LockService moduleNameMapper stub.
        '!**/__tests__/LockServiceUnit.test.ts',
      ],
      moduleNameMapper: {
        ...sharedModuleNameMapper,
        '^opossum$': '<rootDir>/src/__tests__/__mocks__/opossum.ts',
        '^.*/lib/prisma$': '<rootDir>/src/__tests__/__mocks__/prisma.ts',
        '^.*/lib/readReplica$': '<rootDir>/src/__tests__/__mocks__/readReplica.ts',
        '^.*/lib/logger$': '<rootDir>/src/__tests__/__mocks__/logger.ts',
        '^.*/CircuitBreakerService$': '<rootDir>/src/__tests__/__mocks__/CircuitBreakerService.ts',
        '^.*/utils/LockService$': '<rootDir>/src/__tests__/__mocks__/LockService.ts',
        '^multer$': '<rootDir>/src/__tests__/__mocks__/multer.ts',
        '^sharp$': '<rootDir>/src/__tests__/__mocks__/sharp.ts',
        '^.*/middleware/rateLimit$': '<rootDir>/src/__tests__/__mocks__/rateLimit.ts',
      },
      setupFiles: ['<rootDir>/src/__tests__/unitSetup.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/otelTeardown.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
    },
    {
      displayName: 'e2e',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/integration/*.e2e.test.ts'],
      moduleNameMapper: sharedModuleNameMapper,
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
      testTimeout: 15000,
    },
    {
      displayName: 'db',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/database/*.db.test.ts'],
      moduleNameMapper: { '^uuid$': sharedModuleNameMapper['^uuid$'] },
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
      testTimeout: 30000,
    },
    {
      displayName: 'mocks',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/mocks/*.mock.test.ts'],
      moduleNameMapper: { '^uuid$': sharedModuleNameMapper['^uuid$'] },
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
      testTimeout: 10000,
    },
    {
      displayName: 'circuit-breaker',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/services/__tests__/CircuitBreakerService.integration.test.ts'],
      moduleNameMapper: {
        '^opossum$': require.resolve('opossum'),
        '^.*/lib/logger$': '<rootDir>/src/__tests__/__mocks__/logger.ts',
      },
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
      testTimeout: 15000,
    },
    {
      displayName: 'ai-circuit-breaker',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/services/__tests__/AIService.circuitBreaker.test.ts'],
      moduleNameMapper: {
        '^opossum$': '/workspaces/socialflow-ai-dashboard/node_modules/opossum/index.js',
        '^.*/lib/prisma$': '<rootDir>/src/__tests__/__mocks__/prisma.ts',
        '^.*/lib/logger$': '<rootDir>/src/__tests__/__mocks__/logger.ts',
        '^uuid$': sharedModuleNameMapper['^uuid$'],
      },
      setupFiles: ['<rootDir>/src/__tests__/unitSetup.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
      testTimeout: 15000,
    },
    {
      // Dedicated project for LockService unit tests (issue #1112).
      // Must NOT include the LockService moduleNameMapper stub so the tests
      // can load the real implementation via jest.resetModules() + require().
      displayName: 'lock-service-unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/__tests__/LockServiceUnit.test.ts'],
      moduleNameMapper: {
        ...sharedModuleNameMapper,
        '^opossum$': '<rootDir>/src/__tests__/__mocks__/opossum.ts',
        '^.*/lib/prisma$': '<rootDir>/src/__tests__/__mocks__/prisma.ts',
        '^.*/lib/readReplica$': '<rootDir>/src/__tests__/__mocks__/readReplica.ts',
        '^.*/lib/logger$': '<rootDir>/src/__tests__/__mocks__/logger.ts',
        '^.*/CircuitBreakerService$': '<rootDir>/src/__tests__/__mocks__/CircuitBreakerService.ts',
        '^multer$': '<rootDir>/src/__tests__/__mocks__/multer.ts',
        '^sharp$': '<rootDir>/src/__tests__/__mocks__/sharp.ts',
        '^.*/middleware/rateLimit$': '<rootDir>/src/__tests__/__mocks__/rateLimit.ts',
        // NOTE: '^.*/utils/LockService$' is intentionally omitted so the real
        // LockService module is loaded when tests call require('../utils/LockService').
      },
      setupFiles: ['<rootDir>/src/__tests__/unitSetup.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/__tests__/otelTeardown.ts'],
      transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
    },
  ],
};
