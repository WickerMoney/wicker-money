# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

GitHub release notes are generated from commit subjects; this file is the
curated, human-readable version.

## [Unreleased]

### Added

- **Account allowances.** The Budgets page has an "Account allowances"
  section: a monthly amount measured against one checking account instead of
  one category. Everything that leaves the account counts, except transfers,
  income, and the categories you choose to exclude (Holiday Gifts, say, which
  keeps its own window). What is left rolls into the next month, and an
  overspend carries forward as a negative. Allowances show in the Budget
  breakdown widget as "<account> spending" and are copied when you start a
  month from the previous one. New migration `027` adds
  `plugin_budgets.account_lines`; the Budgets plugin now also asks for read
  access to `accounts`. An account with an allowance counts as in use, so
  deleting it asks for the usual confirmation. The settings export gains
  `accountLines`.

### Changed

- **Old images are pruned.** `package-cleanup.yml` and `preview-cleanup.yml`
  remove old `:edge-<short sha>` tags, old prereleases, untagged versions and
  the preview images of closed or deleted branches. `:latest`, `:next`, `:edge`
  and stable version tags are never deleted. See "Pruning old images" in
  `DEVELOPMENT.md`.

## [0.4.2] - 2026-10-06

Phone layouts, a tidier UI and a round of accessibility and matching fixes. No
migrations, and the API, plugin SDK and ui-kit changes are additive only, so
upgrading and going back to 0.4.1 are both just a change of image. One
start-up check is stricter; see **Changed**.

### Added

- **Phone navigation.** Below 860px the sidebar is a drawer opened from a
  menu button. Tapping a link, including the current page's, closes it.
- **Card layouts on phones.** Transactions, Accounts, Recurring and
  Categories show one card per row at 560px and below, with a "Select all on
  this page" checkbox on Transactions. The dashboard time range is a 3 x 2
  grid and the Transactions pager is a single centred line.
- **Collapsible Categories and Rules.** Parents are accordion rows with a
  child count, and rules are grouped by category, each with Expand all /
  Collapse all. Both start collapsed; a parent opens by itself when you add or
  move a child under it.
- **Icon row actions.** Edit, Delete, Archive and similar actions on
  Transactions, Categories, Rules, Accounts and Recurring are icon buttons
  that never wrap, with the label as tooltip and accessible name.
- **`:edge` image.** Every merge to `main` now publishes
  `ghcr.io/wickermoney/wicker-money:edge` (and `:edge-<short sha>`) after CI
  passes, for running `main` without waiting for a tag. It is not a release and
  never takes `:latest` or `:next`. See the "The `:edge` image" section of
  [DEVELOPMENT.md](DEVELOPMENT.md).

### Changed

- **The production start-up check also refuses `change-me`, `change_me` and
  the quickstart's `CHANGE_ME`** in `DATABASE_URL` or `AUTH_SECRET`, as it
  already did `changeme`, `testpw` and `_dev_password`, and now ignores case.
  Those placeholders are publicly known, so an instance
  running on one now stops at start-up (the `migrate` step too, since the image
  runs in production mode) instead of carrying on with a guessable signing
  secret. The error says what to do. **Only an instance that was given a
  placeholder is affected;** the quickstart tells you to generate real values.
  If yours was, before pulling `0.4.2`:
  1. In `.env`, set `AUTH_SECRET` to the output of `openssl rand -base64 48`.
     If `APP_DB_PASSWORD` was left as `CHANGE_ME` (or another placeholder), set
     it to `openssl rand -hex 24` (letters and digits only: it goes inside a
     URL). `POSTGRES_PASSWORD`, the owner password, is not checked and does not
     change this way; see the docs page if you want to rotate it too.
  2. Run `docker compose pull && docker compose up -d`. The `migrate` service
     runs first and reinstalls the tenant key from the new `AUTH_SECRET` and
     sets the app role's new password.
  3. Everyone signs in again if `AUTH_SECRET` changed; nothing else is lost.

  Not using the sample compose? See
  [Placeholder credentials](https://wickermoney.dev/docs/self-hosting/upgrading#placeholder-credentials).
- **`docker-compose.sample.yml` passes `REGISTRATION_ENABLED` and
  `TRUST_PROXY` through** to the app, with the app's own defaults. The README
  already told you to set them, but the sample did not forward them, so
  setting them in `.env` did nothing.

### Fixed

- **Accessibility.** Each page sets its own browser tab title, there is a
  "Skip to content" link, and focus moves to the page after you navigate
  (not on first load). The sign-in and not-found pages have a heading, and a
  loading spinner announces its label. The light-mode warning colour was
  3.6:1 on the page background and is now 5.9:1, and archived or disabled
  names are no longer faded to 55% opacity.
- **Recurring matching.** Candidate transactions for matching were capped at
  500 across all accounts, oldest first, and included transactions that already
  settle another occurrence, so on a long ledger the newest transactions could be
  dropped. The cap is now per account, keeps the newest, and leaves linked
  transactions out.
- **Performance.** The Transactions page no longer runs the suggestion lookup
  for a page whose rows are all matched already, and the Spending trends chart
  no longer recomputes its layout every time you hover a bar.
- **Budgets.** The window form no longer aligns to the Amount hint's height,
  and the dashboard breakdown fills one column to the card's height before
  spilling into a second, instead of leaving a blank card.
- **Insights and Spending trends** charts are drawn at the container's width
  instead of a fixed 1200px, so their labels are readable on phones.
- **Upcoming** account outlook stacks as cards on phones, and the Forecast
  range buttons and Spending chips have 40px touch targets.

## [0.4.1] - 2026-10-05

Two new starter categories. No migrations: upgrading and going back to
0.4.0 are both just a change of image. The new categories are not added to
existing accounts automatically; see the note below.

### Added

- **Two new starter categories.** **Memberships** (under Subscriptions) is
  in everyone's base set, for store and shopping memberships such as
  Costco or Amazon Prime. **Domains / web hosting** (under Technology) is
  added when you tick the setup question about smart home, networking,
  gaming or web hosting, which now says that it covers hosting.
  Already set up? Open **Categories → Run setup again** to add new starter
  categories; your existing categories are kept.

## [0.4.0] - 2026-10-04

The plugin manager, matching from the Transactions page, and form errors
that show on the field they are about. **Back up your database before
upgrading:** this release has two migrations, 025 and 026. Both have a
`down`, so going back to 0.3.0 is `node dist/db/cli.js down` twice with the
0.4.0 image, then the old image; that discards dismissed suggestions and puts
the old "everyone is an owner" default back. Node 22.22.2+ (or 24.15+) is
now required to build from source; the container image is unaffected. See
[Upgrading](README.md#upgrading).

**Owner and member roles now mean something.** Only the first account on an
instance is its owner; accounts registered after it are members. Existing
accounts keep their role, so on an instance where several people registered
before this release, every one of them is still an owner. See
[Owners and members](README.md#owners-and-members) for how to check and
demote.

Two behaviour changes for API callers: `validation_failed` messages are
reworded (a client that matches on message text needs updating), and
`GET /api/v1/transactions?uncategorized=true` no longer returns linked
transfer legs.

### Added

- **Plugin manager.** A **Plugins** section in Settings (`/settings#plugins`)
  lists every bundled plugin with its version, what it adds and whether it
  is on, off or failed to load (with the reason). An owner can turn any
  plugin on or off; the change applies live, with no page reload: its pages,
  sidebar entry and dashboard widgets appear or disappear. Turning a plugin
  off deletes nothing: its schema, rows and database role stay, and turning
  it back on restores everything. Several plugins in the same area can be on
  together. Other open tabs pick up a change when they regain focus. A
  member sees the list read-only. Opening a turned-off plugin's page shows
  "*Name* is turned off" instead of "Not found", with a link to the plugin
  list for owners.
- `GET /api/v1/plugins/registry` (every registered plugin, enabled or not,
  with `status` and `failure`) and `PATCH /api/v1/plugins/:pluginId`
  (`{ "enabled": boolean }`, idempotent; the response carries `previous`,
  `changed`, `changedBy` and `changedAt`). Both are owner-only and answer
  `403 owner_required` to a member. While a plugin is off its own routes
  answer `404 plugin_disabled`.
- **Match from the Transactions page.** A Recurring column shows, for each
  transaction, the occurrence it paid (with Unmatch), a suggested match to
  confirm with one click, or **Other** to pick a different occurrence. It
  costs one request per page, not one per row.
- **Dismiss a suggested match** ("Not this"), on both the Transactions and
  the Recurring page, so that pair is never suggested again. The same
  transaction can still be suggested for other occurrences, and a dismissal
  can be undone. Matching a dismissed pair by hand clears the dismissal;
  dismissing one leg of a transfer dismisses its partner too.
- Endpoints: `POST` and `DELETE /api/v1/recurring-items/:id/occurrences/:date/dismissals[/:transactionId]`,
  `GET /api/v1/recurring-items/transaction-matches?transactionIds=…` (1–200
  ids) and `GET /api/v1/recurring-items/transaction-matches/:transactionId`.
  `GET /recurring-items/suggestions` also returns `dismissed`, and each
  candidate carries `dismissed`. Additive.
- **Form errors on the field.** Every form in the app and in the bundled
  plugins (categories and rules, accounts, transactions, recurring items,
  time zone, sign in and sign up, budgets, CSV import) checks what it can in
  the browser, with the API's own rules, and shows each error under the
  field it is about. Anything that is not about one field shows beside the
  form's button, and focus moves to the first problem. Messages are
  sentences, not schema paths. A rule's "At least 0" now means no minimum,
  and the field says so.
- Every `validation_failed` response carries `issues: { path, message }[]`
  (never empty; an empty `path` means the request as a whole). Bundled
  plugin errors may carry `issues` in the same shape.
- `@wickermoney/ui-kit`: `FormError`, `formErrorsFrom`, `useFormErrors`,
  `validationIssuesOf`, `NO_FORM_ERRORS`, `hasFormErrors` and their types,
  and an optional `hint` on `Field` and `SelectField`. Additive.
- `role` (`owner` or `member`) on the signed-in user, from sign-up, login,
  refresh and `GET /api/v1/auth/me`.
- The dev seed (`pnpm seed` in `apps/api`) gives the household persona a matching history: matched,
  skipped, late, suggested and dismissed occurrences, dated relative to
  today.
- The data export has a `recurringMatchDismissals` section.
- VS Code tasks and launch configurations for the dev loop (dev servers,
  migrate up and down, seed, local Postgres, and debugging the API, the web
  app or both).

### Changed

- Only the first account on an instance becomes its owner; later sign-ups
  are members. Existing accounts are not changed.
- `validation_failed` messages are reworded, the top-level `message`
  included (its `path: message` form stays). Per-leg recurring errors now
  name the leg (`legs.0.amount`), and transfer errors point at `toAccountId`
  or `amount`.
- The Transactions pager shows "Page 3 of 25" once the total is known.
- `SelectField` now wires `aria-describedby` to its error, like `Field`.
- Building from source needs Node 22.22.2+ or 24.15+ (jsdom 30's range;
  `pnpm install` refused older versions already). Dependency updates
  throughout, including jsdom 30, Fastify 5.12.5, Kysely 0.29.6, Vite 8.3.2
  and Vitest 5.0.3.

### Fixed

- "Only uncategorized" on the Transactions page no longer lists linked
  transfer legs, which can never take a category, so an empty list now
  means everything is filed. The query also uses the partial index built
  for it.
- When the API serves the app, the saved theme is applied before first
  paint again. The pre-paint script was inline, which the Content Security
  Policy (`script-src 'self'`) blocked, so dark-mode users saw a white flash
  on every load and a CSP error in the console.
- A form error no longer lands only in an alert at the top of the page,
  where it could be off-screen (entering `0` as a rule's "At least" seemed to
  do nothing).

### Migrations

- **025_recurring_match_dismissals** adds
  `core.recurring_match_dismissals`, one row per dismissed (transaction,
  item, nominal date) pair, keyed by item and date so it survives the
  occurrence record being cleaned up. Row-level security forced, composite
  keys, deleted with the transaction or the item. It also adds
  `UNIQUE (user_id, id)` on `core.transactions` for the composite key;
  building it blocks writes (not reads) to transactions for the length of
  one index build. Reversible.
- **026_first_user_owner** changes the `core.users.role` default to
  `member` and has `register_user` make an account the owner only when no
  owner exists yet, under an advisory lock so two simultaneous first
  sign-ups cannot both become owner. Existing rows are not touched.
  Reversible.

## [0.3.0] - 2026-10-03

Paid / landed matching for recurring items, budget windows, and a shared
money module in `plugin-sdk`. **Back up your database before upgrading:**
this release has two migrations. 023 can be reverted, but 024 has no `down`
(dropping it would discard every match and override), so going back to
0.2.1 means restoring that backup. PostgreSQL 15 or later is required by 024;
16 is already the documented minimum. See [Upgrading](README.md#upgrading).

One behaviour change for API callers: budgets now refuses a planned amount
with more than four decimal places (`400`) instead of truncating it.

### Added

- **Paid / landed matching for recurring items.** Match a transaction to the
  occurrence it paid and "Until payday" and the forecast stop counting it as
  still to come, so a paycheck that lands a day early is no longer counted
  twice. The Recurring page suggests likely matches under **Did these
  land?** (nothing is matched without a click), and each item's new
  **History** panel shows its recent and coming occurrences with what paid
  each one. From there a single occurrence can be matched, skipped, moved to
  another date, or given a different amount (per account, so one side of a
  split paycheck can change), without touching the rest of the series.
  Once an item has been matched at least once, an occurrence that has not
  arrived within a week of its date is flagged late and still counted as
  coming, on the next projected day. Items that are never matched behave
  exactly as before. The widget and the forecast tag arrived and late
  occurrences.
- **Per-occurrence overrides in `@wickermoney/plugin-sdk/recurrence`**:
  `RecurringItem.overrides` (skip, move, replace the legs of one
  occurrence, keyed by nominal date), honoured by `dailyBalances`,
  `flowTotals` and `nextPayday`, plus `scheduledOccurrences` and
  `nextScheduledOccurrence`. Additive; items without overrides project as
  before.
- **Budget windows.** A budget line can now cover a date range instead of a
  calendar month: one amount for one category, spent down to zero, such as
  holiday gifts from October 1 through December 25. Add one in the new
  **Windows** section of the Budgets page. In each month it touches, the
  window shows what was left coming in, what that month spent, and what is
  left now. Under the category name it shows "spent so far of funded" for
  the whole window. The full amount counts toward planned only in the first
  month, so totals never fund it twice. Spending in that category outside
  the window's dates still shows as unbudgeted. Pace is measured over the
  window, and only an overdrawn pot marks a window as over. Bunched-up
  spending is expected and never counts as "at risk".
- **`@wickermoney/plugin-sdk/money`**, a public module for exact money
  arithmetic on decimal strings (also exported from the package root).
  It has string helpers (`addMoney`, `sumMoney`, `compareMoney`,
  `equalMoney`, `isZeroMoney`, `editableMoney`, ...) and a `bigint` layer
  (`moneyToUnits`, `unitsToMoney`, `divideUnits`) for loops. Input with more
  than four decimal places throws instead of being truncated. The only
  rounding is division, half away from zero, the same rule the API uses.
  Budgets, insights, spending trends and the recurrence module now share it
  instead of each keeping its own copy.
- A hand-run **preview image** workflow (`.github/workflows/preview-image.yml`)
  that builds a branch into a separate, private
  `ghcr.io/wickermoney/wicker-money-preview:<branch>` image, plus
  `docker/docker-compose.preview.yml` to try it beside a real install. See
  [Trying a branch before it merges](DEVELOPMENT.md#trying-a-branch-before-it-merges).

### Changed

- Budgets refuses a planned amount with more than four decimal places (400)
  instead of quietly truncating it, the same as the rest of the API.
- Recurring occurrence views (the occurrences list, "Until payday", the
  forecast's entries) carry `nominalDate`, `expectedDate` and `status`, and
  each leg the transaction that settled it. `date` is where the list places
  the occurrence, which for a late one in a projection is the first
  projected day; `(itemId, nominalDate)` is its identity. Items carry
  `tracked` and `late`, and `nextDue` passes over skipped and already-paid
  occurrences.

### Migrations

- **024_recurring_occurrences** adds `core.recurring_occurrences` and
  `core.recurring_occurrence_legs` (row-level security forced, composite
  keys, in the export, granted with `recurring_items`) and a nullable
  `core.transactions.recurring_occurrence_id`. Additive, no backfill. Its
  foreign key uses `ON DELETE SET NULL (column)`, which needs PostgreSQL 15
  or later; 16 is already the documented minimum.
- **023_budget_windows** adds the `btree_gist` extension (a trusted
  extension, so the non-superuser owner can create it) and an exclusion
  constraint so a category cannot have two budget lines on the same day.
  It is reversible: `pnpm migrate:down` deletes any windows and drops the
  constraint, which leaves monthly lines exactly as 0.2.1 had them.

## [0.2.1] - 2026-10-02

Recurring items, Phase B: the forecast. Also the fix for 0.2.0's known
limitation: you can now set your time zone. **No migrations**, so
upgrading from 0.2.0 is a pull and a restart, and going back to 0.2.0 is
safe. After upgrading, open **Settings → Time zone**. Accounts made before
this release are still on `UTC`, and the section offers your browser's zone
in one click.

### Added

- **Forecast page**, from a new bundled, read-only plugin (`plugins/forecast`,
  `wickermoney.forecast`; sidebar, after Recurring). It projects one account's
  balance day by day from its recurring items, starting from today's actual
  balance. Pick the account and 30 days, 60 days, 90 days, 6 months or end of
  year. It is a step chart, with each day's outflows drawn before its inflows,
  so a bill due on payday shows as the dip it is. Zero and the account's buffer
  are marked. A banner names the first day the account drops below either. Stat
  tiles show today, the end, the lowest point, days below zero and days below
  the buffer. A list shows what moves the line, with transfers kept neutral and
  their direction spelled out. Cards and loans get the chart without overdraft
  or buffer warnings. The line covers recurring items only, not everyday
  spending, and the page says so.
- `GET /api/v1/core/recurring-items/forecast?accountId&horizon` (needs the
  `recurring_items` and `accounts` grants). `horizon` is `30d`, `60d`, `90d`
  (default), `6m` or `eoy`, resolved against the user's today on the server.
  The response has the daily series (end balance and low), the stats, the
  first breach of zero and of the buffer, and the occurrences on the account.
- **Time zone setting.** A Time zone section in Settings, and
  `PATCH /api/v1/auth/me` with `{ "timezone": "America/New_York" }`. Zones are
  IANA names, matched case-insensitively and stored canonically. Fixed offsets
  such as `+01:00` are refused. `GET /api/v1/auth/me` now returns the zone too.
- Registration takes the browser's time zone (optional `timezone` in
  `POST /api/v1/auth/register`). An unrecognised zone keeps `UTC` and does not
  fail the sign-up.

### Fixed

- "Today" on the Recurring page and in "Until payday" no longer rolls over
  in the evening west of UTC, once your time zone is set (the 0.2.0 known
  limitation).
- Six integration tests in the budgets and insights suites failed with `401`
  between the 1st and the 14th of every month. They pinned the clock to the
  15th after issuing access tokens, so the tokens looked expired.

## [0.2.0] - 2026-10-02

Recurring items and the "Until payday" dashboard (Phase A of recurring items).
**Back up your database before upgrading:** migration 021 reshapes
`core.recurring_items` and has no `down` (PostgreSQL cannot drop the new
`once` enum label), so going back to 0.1.0 means restoring that backup. See
[Upgrading](README.md#upgrading).

Known limitation: "today" comes from `core.users.timezone`, which defaults to
`UTC` and has no setting yet, so west of UTC the recurring page and widget move
to tomorrow in the evening. See
[Recurring items](DEVELOPMENT.md#recurring-items-and-until-payday) for the
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

[Unreleased]: https://github.com/WickerMoney/wicker-money/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/WickerMoney/wicker-money/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/WickerMoney/wicker-money/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/WickerMoney/wicker-money/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/WickerMoney/wicker-money/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/WickerMoney/wicker-money/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/WickerMoney/wicker-money/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WickerMoney/wicker-money/releases/tag/v0.1.0
