# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

GitHub release notes are generated from commit subjects; this file is the
curated, human-readable version.

## [Unreleased]

## [0.2.0] - 2026-10-02

Recurring items and the "Until payday" dashboard (Phase A of recurring items).
**Back up your database before upgrading:** migration 021 reshapes
`core.recurring_items` and has no `down` (PostgreSQL cannot drop the new
`once` enum label), so going back to 0.1.0 means restoring that backup. See
[Upgrading](README.md#upgrading).

Known limitation: "today" comes from `core.users.timezone`, which defaults to
`UTC` and has no setting yet, so west of UTC the recurring page and widget move
to tomorrow in the evening. See
[Recurring items](README.md#recurring-items-and-until-payday) for the
workaround.

### Added

- **Recurring items.** A Recurring page (sidebar, after Transactions) to create,
  edit, end and delete recurring income, bills, debt payments and transfers.
  Items are grouped by kind with a server-derived next due date (never the
  anchor), a readable schedule, where the money goes, and an exact monthly
  equivalent; monthly tiles total income, bills and what is left over. A split
  paycheck is one item with a leg per account. Ended series sit behind
  *Show ended*.
- **"Until payday" dashboard widget**, from a new bundled, read-only plugin
  (`plugins/upcoming`, `wickermoney.upcoming`). It shows safe to spend until the
  next payday (or 14 days if no income is expected), each checking account's
  lowest point and room above its buffer, a shortfall banner naming any account
  that would drop below its buffer, and what lands before payday. One account's
  surplus is never netted against another's shortfall.
- **Choose which accounts count toward safe to spend** (migration 022,
  `core.accounts.spendable`). Existing checking accounts are backfilled to
  spendable, so nobody's number changes on upgrade; only checking and savings
  can be spendable. Set it per account on the Accounts page.
- **Edit an account's buffer** on the Accounts page (new Buffer column for
  checking and savings).
- Recurring items API: `GET/POST /api/v1/recurring-items`,
  `GET/PUT/DELETE /api/v1/recurring-items/:id`, `POST /:id/end`, and
  `GET /api/v1/recurring-items/occurrences` (half-open range, default today
  plus 31 days, at most 400). "Today" is the user's calendar day in
  `users.timezone`, computed on the server and returned with every response.
  Plugin routes `GET /api/v1/core/recurring-items/list`, `/occurrences` and
  `/upcoming` sit behind the `recurring_items` grant (`/upcoming` also needs
  `accounts`).
- `plugin-sdk`: a pure, dependency-free recurrence module at the package root
  and at a new `@wickermoney/plugin-sdk/recurrence` subpath (zod-free, safe in
  the browser): `occurrences`, `nextOccurrence`, `nextPayday`,
  `monthlyEquivalent` (exact factors: biweekly is 26/12, not 2.17),
  `dailyBalances` (with a per-day `low`) and `flowTotals`. Monthly, quarterly
  and annual schedules clamp to month end; `once` joins the frequencies.
- `POST /api/v1/transactions/transfer` accepts an optional `externalId`, stored
  on both legs. Like a single transaction's, it is unique per account, so an
  importer can send the same transfer again and get `409 duplicate_external_id`
  instead of a second copy. Neither leg is written when either account already
  has that id.
- Account delete and merge dialogs name the recurring items affected and what
  happens to each (moved, combined, or removed).
- npm READMEs for `@wickermoney/plugin-sdk` and `@wickermoney/ui-kit`.
- A `household` seed persona: two checking accounts (monthly and yearly
  expenses), a split paycheck, two offset biweekly incomes and sinking-fund
  transfers.

### Changed

- **`core.recurring_items` is now an item plus legs** (migration 021). The item
  holds the schedule and a new `kind` (`income`, `bill`, `debt_payment`,
  `transfer`); the new `core.recurring_item_legs` holds one signed amount per
  account. `account_id`, `amount`, `transfer_account_id` and `is_income` are
  dropped from the item after their values are backfilled into legs; rows that
  cannot be represented fail the migration with their ids rather than being
  dropped. Breaking for any plugin that read those columns directly. A
  `recurring_items` grant now also grants `recurring_item_legs`.
- Semimonthly items store their two days (`semimonthly_day_1/2`, default 1st
  and 15th).
- Dashboard: the primary slot honours widget size (`sm`/`md` half a row,
  `lg`/`full` a whole row, one column under 860px). The budgets widget moves
  up beside "Until payday" and is renamed **Budget breakdown** (was *Watch
  list*); it now ranks every line, trouble first, instead of only alarms. The
  budgets at-risk report gains a `breakdown` field.

### Fixed

- Plugins showed calendar dates a day early anywhere west of UTC:
  `ctx.formatDate` parsed `YYYY-MM-DD` as midnight UTC. Calendar dates are now
  built in local time.
- The plugin client's grant guard refused kebab-case core paths
  (`/core/recurring-items`) for a plugin granted the snake_case table.
- A negative account buffer is now a `400` with a message instead of a
  database error surfacing as a `500`.
- `core.recurring_items.category_id` gets the composite `(user_id, ...)` key
  migration 009 missed.

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

[Unreleased]: https://github.com/WickerMoney/wicker-money/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/WickerMoney/wicker-money/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WickerMoney/wicker-money/releases/tag/v0.1.0
