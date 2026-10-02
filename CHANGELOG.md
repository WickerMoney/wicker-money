# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

GitHub release notes are generated from commit subjects; this file is the
curated, human-readable version.

## [Unreleased]

### Added

- `POST /api/v1/transactions/transfer` accepts an optional `externalId`, stored
  on both legs. Like a single transaction's, it is unique per account, so an
  importer can send the same transfer again and get `409 duplicate_external_id`
  instead of a second copy. Neither leg is written when either account already
  has that id.

## [0.1.0] - 2026-09-28

### Added

- **M4, release readiness and brand identity.** Self-hosting quickstart and a
  full-stack `docker/docker-compose.sample.yml`; `@wickermoney/plugin-sdk` and
  `@wickermoney/ui-kit` published to npm via OIDC trusted publishing; a
  `semimonthly` recurrence frequency (migration 020); a light/dark/system
  theme switcher pinned to the sidebar account menu; and the brand accent and
  chart palette below, derived from the actual logo.
- **M3, import and categorization.** `plugins/import-csv`: saved column mapping
  per source, explicit date format with live parse preview, duplicate detection,
  batch undo. Categories page with rules (with a preview before a rule touches
  anything), and triage on the Transactions page.
- **M2, the shell and the first plugin.** Real web host with sign-in, navigation
  and a dashboard fed entirely by plugins over Module Federation. Per-plugin
  database roles derived from each manifest's `requiredTables`.
- **M1, auth and ledger.** Users, sessions, accounts, categories, category rules,
  transactions and splits, all under row-level security. Account balances are
  derived from the ledger, never stored. First-run onboarding (migration 010)
  and secure, httpOnly refresh-token cookies.
- Budgets plugin with per-category budgets and per-line rollover.
- Container image (amd64 and arm64) served by the API on a single port.
- `ui-kit`: a shared, validated chart palette (`--wm-chart-1` … `-6`,
  `--wm-chart-other`, plus chart surface, ink and grid tokens). The bundled
  chart plugins alias it instead of carrying their own copies.

### Changed

- `ui-kit`: renamed every design token and class from `fio-` to `wm-`
  (breaking for anyone styling against the old prefix directly).
- `ui-kit`: `--wm-accent` is now the brand green from the logo (`#2e500d`
  light, `#a9d173` dark) instead of blue, with dark-mode `--wm-accent-text`
  switched to a dark ink so text on the accent stays readable.
  `--wm-positive` shifts toward teal (`#0c7e65` / `#29a987`) so a link and a
  gain no longer look alike.

### Security

- Migration 009: composite `(user_id, ...)` keys close a cross-user hole where a
  foreign key could attach a transaction to another user's account.

[Unreleased]: https://github.com/WickerMoney/wicker-money/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/WickerMoney/wicker-money/releases/tag/v0.1.0
