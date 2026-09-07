import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Next.js app root — used to resolve the SWC transform and path aliases.
  dir: './',
});

const config: Config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  moduleNameMapper: {
    // next/jest resolves "@/..." from tsconfig, but keep an explicit mapping
    // so tests are robust to tsconfig changes.
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default createJestConfig(config);
