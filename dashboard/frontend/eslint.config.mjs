import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

// Next 16 ships core-web-vitals as a native flat config. The previous
// FlatCompat `extends('next/core-web-vitals')` path crashes ESLint 9 with
// "Converting circular structure to JSON" once eslint-config-next is 16.x
// (Dependabot #74).
export default defineConfig([
  ...nextVitals,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'node_modules/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
]);
