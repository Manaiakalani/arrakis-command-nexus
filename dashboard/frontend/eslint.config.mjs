import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

// Next 16 ships core-web-vitals as a native flat config. The previous
// FlatCompat `extends('next/core-web-vitals')` path crashes ESLint 9 with
// "Converting circular structure to JSON" once eslint-config-next is 16.x
// (Dependabot #74). Keep the same rule surface as before: vitals only, not
// the TypeScript/react-hooks compiler preset, which flags existing effects.
export default defineConfig([
  ...nextVitals,
  {
    // Next 16's core-web-vitals preset now includes the React compiler plugin.
    // Those rules were not part of the Next 15 preset this repo linted against,
    // and they fire on existing effects/refs. Keep the previous rule surface
    // so the version bump is not a drive-by rewrite of every dashboard page.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
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
