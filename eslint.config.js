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
  // SQL injection guard. Kysely sends every `${value}` in a sql`` template as a
  // bound parameter, so ordinary queries cannot be injected. `sql.raw()` is the
  // exception: it splices text into the statement unescaped. It is needed for
  // identifiers (role, table and column names cannot be parameters), and that
  // is the job of the database layer and migrations, where every call site is
  // reviewed. Anywhere else, use a bound value, `sql.id` / `sql.ref` /
  // `sql.table` for names, or a lookup map keyed by a validated enum.
  //
  // Allowed: the database layer (including migrations), keyset paging (column
  // and cast come from fixed maps keyed by a validated enum), and tests.
  //
  // `no-restricted-syntax` replaces rather than merges across config blocks, so
  // a later block that sets it for the same files must repeat this selector.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    ignores: [
      'apps/api/src/db/**',
      'apps/api/src/transactions/repository/keysetFilter.ts',
      'apps/api/src/testing/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='sql'][property.name='raw']",
          message:
            'sql.raw() splices text into the statement unescaped. Use a bound value, sql.id / sql.ref / sql.table for names, or move this into apps/api/src/db. See the SQL injection guard in eslint.config.js.',
        },
        {
          selector: "VariableDeclarator[init.name='sql'] > ObjectPattern > Property[key.name='raw']",
          message: 'Do not destructure sql.raw out of sql; it bypasses the sql.raw() guard in eslint.config.js.',
        },
      ],
    },
  },
)
