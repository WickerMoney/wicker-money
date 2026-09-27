# Contributing to Wicker Money

Thanks for your interest. Wicker Money is pre-1.0 and has a single maintainer,
so a few honest expectations up front: reviews may be slow, some ideas will
get a "not now", and things may change under you.

## Before you start

Right now I'm accepting **issues and suggestions**, not feature pull requests.
The plugin contract is still being settled and third-party plugin install isn't
supported yet, so most outside code would need reworking. Typo, docs and small
bug-fix PRs are fine. This will change once the plugin contract is stable and
versioned.

- Open an issue before working on anything larger than a small fix. It saves
  both of us from a pull request that does not fit.
- The plugin API is not frozen. Changes that touch it may be rejected or
  reworked, even if the code is good.
- Core versus plugin: the core owns identity, money movement and the app shell.
  Anything that *interprets* money (budgets, forecasting, importers) belongs in
  a plugin. If you are unsure which yours is, ask in the issue.

## Reporting bugs and requesting features

Use the issue templates. For vulnerabilities, do not open an issue; see
[SECURITY.md](SECURITY.md).

## Development setup

Requires Node 22+ and pnpm 10 (`corepack enable pnpm`).

```bash
pnpm install
pnpm build
pnpm test
```

| Command | What it does |
|---|---|
| `pnpm dev` | Runs api and web in watch mode |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm build` | Builds packages, then apps |
| `pnpm test` | Unit tests in every package (no database needed) |
| `pnpm test:integration` | API integration tests against a real PostgreSQL |

For a local database, `docker compose -f docker/docker-compose.dev.yml up -d`
and `cp .env.example .env`. The README covers the database roles in detail; the
short version is that the API must connect as a non-owner, non-superuser role
or row-level security is silently inert.

## Pull request expectations

- Keep pull requests small and focused on one change.
- Add or update tests for behavior changes. Tests that touch data isolation
  should run against a real PostgreSQL (`pnpm test:integration`), not a mock.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass.
- Do not include unrelated reformatting.
- Update docs if behavior changes.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit
  subjects (`feat:`, `fix:`, `docs:`, `chore:` ...). Release notes are built
  from them.
- Money is `numeric(19,4)` in PostgreSQL and `string` in TypeScript. Never
  `number`.

## Contribution licensing

Contributions are licensed under the license of the component you change
(inbound equals outbound). For example, a change to `plugin-sdk` or `ui-kit` is
licensed under Apache-2.0, and a change to the app or a bundled plugin is
licensed under AGPL-3.0.

<!-- TODO(D2): CLA vs DCO undecided; decide before the first outside PR because DCO alone does not permit relicensing -->

## Code of Conduct

Participation is governed by the
[Code of Conduct](https://github.com/wickermoney/.github/blob/main/CODE_OF_CONDUCT.md).
