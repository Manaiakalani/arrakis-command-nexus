import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

// Next 16 ships core-web-vitals as a native flat config. The previous
// FlatCompat `extends('next/core-web-vitals')` path crashes ESLint 9 with
// "Converting circular structure to JSON" once eslint-config-next is 16.x
// (Dependabot #74).
export default defineConfig([
  ...nextVitals,
  // eslint-plugin-react 7.37.5 still calls context.getFilename() when
  // settings.react.version is "detect"; that API was removed in ESLint 10.
  { settings: { react: { version: "19.2.8" } } },
  // Next's default parser is compiled @babel/eslint-parser, whose scope
  // manager lacks addGlobals (required by ESLint 10). TS/TSX already use
  // typescript-eslint; apply that parser to JS config files too.
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: { parser: tseslint.parser },
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
