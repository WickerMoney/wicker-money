import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      // Built plugin remotes and the type packages Module Federation generates
      // from them. Both are build output that happens to land inside the
      // source tree, so the ignore list has to name them explicitly.
      'apps/web/public/plugins/**',
      '**/@mf-types/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Loose Node scripts that live outside any TypeScript project (build/release
  // tooling like docker/stamp-version.mjs) -- .ts/.tsx files get `process`,
  // `console` etc. from @types/node, and typescript-eslint's recommended config
  // turns `no-undef` off for them because of it, but that config only matches
  // TS files, so a plain .mjs/.cjs script is still checked by eslint:recommended
  // alone and needs the runtime globals declared explicitly. Listed inline
  // rather than pulling in the `globals` package for two names.
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // Browser code runs on plain HTTP for LAN self-hosting, where secure-context
  // APIs are missing. crypto.randomUUID is the one that has bitten us: call
  // newUuid() (apps/web/src/lib) instead, which falls back to getRandomValues.
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'plugins/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'crypto',
          property: 'randomUUID',
          message:
            'crypto.randomUUID only exists over HTTPS or localhost. Use newUuid() from apps/web/src/lib/newUuid.ts (or an equivalent fallback) so plain-HTTP installs work.',
        },
      ],
    },
  },
  // Architecture guard: only repositories (and the composition/data/db layers)
  // may talk to the database. Handlers and services depend on repository
  // interfaces reached through the unit of work, never on Kysely or the
  // connection helpers.
  {
    files: ['apps/api/src/**/routes/**/*.ts', 'apps/api/src/**/service/**/*.ts'],
    ignores: ['**/*.test.ts', '**/service/testing/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['kysely', '**/db/client.js', '**/db/Trx.js', '**/repository/Kysely*'],
              message:
                'Handlers and services must not touch the database. Add a method to a repository and call it through the UnitOfWork.',
            },
          ],
        },
      ],
    },
  },
)
