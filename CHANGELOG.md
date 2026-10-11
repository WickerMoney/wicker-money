# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

GitHub release notes are generated from commit subjects; this file is the
curated, human-readable version.

## [Unreleased]

### Breaking
- **The SDK root no longer exports the Zod manifest schemas.**
  `pluginManifestSchema`, `tableGrantSchema`, `widgetContributionSchema`,
  `pageContributionSchema` and `remoteEntrySchema` are no longer exported from
  `@wickermoney/plugin-sdk`. Exporting them tied the stable root to Zod's major
  version. Nothing in this repository imported them; they were used only inside
  the SDK. **Migration:** to validate a manifest, call `parseManifest(input)`,
  which returns `{ manifest }` on success or `{ error }` with a readable message
  (it also rejects a manifest built against a newer SDK major). The types
  (`PluginManifest`, `TableGrant`, `WidgetContribution`, `PageContribution`) and
  `checkRemoteEntry` are unchanged. `zod` is still a dependency of the SDK,
  because `parseManifest` uses it.

### Added
- **Debt payoff plugin, server half.** A new bundled plugin,
  `wickermoney.debt-payoff`, with its own tables (migration 029), endpoints for
  debts and settings, and a snowball and avalanche planner behind
  `GET /api/v1/p/wickermoney.debt-payoff/plan`. The plan is computed exactly in
  integer units of 0.0001, interest compounding monthly at APR/12 and rounded
  once per debt per month, half away from zero; it stops at 600 months and says
  so. It also appears in the settings export. There is no page yet. The plugin
  can read your accounts so a debt can track a loan or credit card, and nothing
  else of the host's.
- **`@wickermoney/plugin-sdk/date`**, a stable entry point for the calendar
  helpers `addDays` and `addMonths`. They moved here from the experimental
  `/recurrence` entry point so that first-party code (Budgets, the API, the web
  app) no longer depends on a tier that may change. Behaviour is unchanged. It
  has no dependencies, so importing it pulls in nothing else from the SDK.
  `/recurrence` and the package root still export both helpers, so existing
  imports keep working; new code should import from `/date`.
- **`useFocusTrap` in `@wickermoney/ui-kit`.** A hook that keeps Tab and
  Shift+Tab inside a container while it is active: Tab from the last tabbable
  element wraps to the first, Shift+Tab from the first wraps to the last, and, if
  focus is outside the container, the next Tab pulls it in. By default it puts
  focus back on whatever had it before the trap turned on once the trap turns off;
  pass `{ restoreFocus: false }` when the caller returns focus somewhere more
  specific. For hand-rolled modals that are not a native `<dialog>`. Exported
  from the package root with the `FocusTrapOptions` type. Additive.
- **A "Show as table" button on the Insights income and spending chart and on
  the Spending trends chart.** The figures were reachable only by hovering or
  focusing a bar. The button swaps the bars for a table of the same numbers and
  back: month, income, spending and net for Insights; month, one column per
  category shown and a total for Spending trends, which follows the category
  filter so the table and the bars never disagree. The Insights donut has no
  toggle, because its legend already lists every value.
- **`caption` on the ui-kit `Table`.** An optional name for the table, rendered
  as a visually hidden `<caption>` that a screen reader announces. Additive. The
  tables on the core pages use it; see **Fixed**.
- **`GET /api/v1/accounts?fields=basic`.** Returns each account's `id`, `name`,
  `accountType`, `currencyCode`, `spendable` and `archivedAt` and nothing else:
  no balance, opening balance or buffer, and none of the sum over every
  transaction that the full list pays for. `includeArchived` works as before.
  Leaving `fields` out or sending `full` gives the unchanged full list; any other
  value is a `400`. The Transactions page fills its account pickers from it.
- **`accountName` on every leg of `GET /api/v1/core/recurring-items/upcoming`.**
  The name of the account the leg is on, archived accounts included, so a client
  can describe a transfer to an account that is not in the outlook's own
  `accounts` list without asking for the account list. Additive: nothing was
  removed or renamed. The Upcoming widget now makes one request instead of two.
  Against an older host that sends no names it still falls back to
  `/core/accounts/list`, and only when a leg names an account the outlook does
  not list; it still renders if that request fails.
- **`truncated` flags on recurring matching.** Candidates for matching come from
  the newest 500 matching transactions per account. A very busy account could
  drop the oldest, with no sign that it had. `GET /api/v1/recurring-items/:id/occurrences/:date/candidates`
  now returns `truncated` on each leg, and `GET /api/v1/recurring-items/suggestions`
  returns a top-level `truncated`, true when a query hit that cap and a match
  needing one of the oldest rows may be missing. Additive; the app does not show
  it yet.

### Changed
- **The host and Budgets import the date helpers from `/date`.** The API, the
  web app, the seed data and Budgets now import `addDays` and `addMonths` from
  `@wickermoney/plugin-sdk/date`. No behaviour change.
- **The image no longer has a `:next` tag.** A release candidate is published
  under its version tag only (for example `:0.6.0-rc.1`), as before, so pin that
  to try one. `:next` followed the newest candidate and fell behind `:latest`
  after every stable release, so it was more often stale than useful; it is no
  longer updated. `:latest` is still stable releases only and `:edge` is
  unchanged. The npm `next` dist-tag for the SDK and UI kit is unchanged.
- **Core pages load when you first visit them.** Accounts, Categories,
  Recurring, Settings and Transactions are separate chunks, fetched on first
  visit with a spinner labelled `Loading <page>`, and a message if a chunk cannot
  be fetched. The Dashboard stays in the main chunk, and the tab title and the
  focus move still happen the moment you navigate, not when the chunk lands.
  Measured with `vite build` on the merged tree, the main chunk went from about
  261 kB (79 kB gzipped) to about 150 kB (47 kB gzipped): about 98 kB from the
  split and another 13 kB from the `sideEffects` entry below.
- **`@wickermoney/ui-kit` declares its side effects.** Its `package.json` now
  lists `./dist/index.js`, which imports the two stylesheets for their effect, and
  `./dist/*.css` as the only files with side effects, so a bundler can drop the
  components a consumer never imports. Nothing is exported differently.
- **The Transactions page does less work.** Selecting a row or typing in the edit
  dialog no longer re-renders every row; a render-count test holds 25 rows to one
  render each through both. Recurring matches are requested for the rows on
  screen: re-reading a list that returns the same rows asks for nothing, a page
  turn or filter change waits 150 ms so a burst of them asks once, and an edit
  asks for matches at once, alongside the list re-read instead of after it. An
  answer to a question that has since been replaced is dropped.
- **The host tells the federation runtime which React it runs.** `loader.ts`
  declared `react` and `react-dom` as 19.0.0 while the app runs 19.3.0; it now
  reads the versions from the installed packages. The runtime prefers the highest
  version on offer, so a stale lower claim could let a plugin's own copy win and
  load React twice. Plugins already reuse the host's React, so nothing changes
  today.
- **Budgets reads the ledger at most three times per month request.** Each
  window used to cost its own scan of the ledger, so a month with N windows read
  it up to N + 2 times. All windows now ask for their spend in one query, each
  clipped to its own start and end, and the carry-forward history scans only the
  earlier months and only the categories that roll over, taking the shown month
  from the read the request already holds. Figures are unchanged; new tests cover
  windows that start or end mid-month, sit back to back on one category, cross a
  year end or net to nothing.
- **Recurring matching reads less.** `match`, `override` and `unmatch` now read
  today and the occurrence's records, links and tracking starts once, then re-read
  only what the write can have changed. Data statements per request, measured with
  the new statement tests: match 16 to 13 (9, down from 14, when the transaction is
  already matched), matching a transfer 17 to 14, unmatch 12 to 11, override 17 to
  14. The Transactions page's recurring-matches request no longer reads the
  transactions of dismissed pairs it never shows and describes only the occurrences
  the suggestions have not already described: 14 to 13 statements on a page with a
  dismissal. Candidate dates and amounts are parsed once per row instead of building
  a `Decimal` for every transaction on every call; a test holds the new ranking to
  the old one over 400 generated rows. Performance only: the responses are the same
  apart from the `truncated` flags above.
- **The API compresses its own responses.** The image serves the web bundle and
  the API from one process, with no proxy guaranteed in front, so it now
  compresses with `@fastify/compress`: brotli (quality 5) or gzip, for responses
  over 1 KiB, skipping types that are already dense such as images. A compressed
  response carries `Vary: Accept-Encoding`; nothing else about it changes. On the
  seeded demo data, a 200-row transactions page went from 103 kB to 8.7 kB with
  brotli (9.6 kB with gzip), and the main script from 150 kB to 45 kB. **Behind a
  reverse proxy, do not compress twice:** leave compression off for this upstream, or make sure
  the proxy passes a response that already has a `Content-Encoding` header through
  untouched. This release has no setting to turn the app's own compression off.

### Fixed
- **The setup wizard and the phone navigation drawer manage focus.** The wizard
  had no focus trap, did not return focus when it closed, pulled focus back to
  the panel on every step, and its loading state had no accessible name. Tab now
  stays inside it, focus goes back to whatever opened it, the heading takes focus
  once per step (and when the questions first appear), and the loading dialog is
  named "Setup". The drawer uses the same `useFocusTrap`, so Tab wraps inside it;
  its Escape handling and the focus return to the menu button are unchanged. Not
  yet checked with a screen reader.
- **Chart marks are exposed to assistive technology.** The donut, the income and
  spending chart and the stacked spending-trends chart put focusable
  `role="listitem"` marks inside `<svg role="img">`. An image makes its children
  presentational, so the marks dropped out of the accessibility tree. Each `<svg>`
  is now `role="list"` with the same label. Not yet checked with a screen reader.
- **The forecast chart's day readout is announced.** The tooltip carried
  `aria-live` and mounted together with its text, which screen readers often skip.
  The chart now keeps a visually hidden `role="status"` region mounted at all
  times, whose text follows the focused or hovered day; the visual tooltip is
  `aria-hidden`, so a day is not read twice.
- **Table headers have scopes, names and no empty cells.** The ui-kit `Table`
  emits `scope="col"`, and a column with an empty header (a column of row buttons)
  gets a visually hidden "Actions" label in the header cell only, so the phone
  card layouts print nothing new. Accounts, Categories, Rules, Recurring,
  Transactions and the Settings server configuration are named with `caption`;
  Import CSV's batch history, mapping preview and review tables gained `scope`, and
  the batch history's action column a labelled header.
- **The account menu is a disclosure, not an ARIA menu.** It declared
  `role="menu"` with no arrow-key handling. The trigger now has `aria-expanded` and
  `aria-controls` and opens a group of ordinary buttons reached with Tab; the theme
  buttons use `aria-pressed` instead of `menuitemradio`. Escape and a click outside
  still close it.
- **The plugin switch announces "Saving…".** The On, Off and Saving text was
  `aria-hidden`; it is now a `role="status"` region.
- **Light-mode `--wm-positive` has more contrast.** The token moved from
  `#0c7e65` to `#0a7660`: on `--wm-surface-alt` it was 4.51:1 and is now 5.01:1,
  and on white 5.01:1 became 5.57:1. The dark theme is unchanged. A test also
  confirms that recurring bills show a minus sign as well as the red colour.

## [0.5.0] - 2026-10-10

Plugin platform hardening, plus account allowances. The plugin contract now
lives in one place (`@wickermoney/plugin-sdk/server`) with documented
stability tiers, the dashboard asks the API once for what several widgets
share, `BOOTSTRAP_OWNER_EMAIL` names the owner of a new instance, and the docs
say plainly what the plugin trust boundary does and does not protect. The
Budgets page gains account allowances. **Back up your database before
upgrading:** this release has two migrations, 027 and 028. Both have a
`down`, so going back to 0.4.2 is `node dist/db/cli.js down` twice with the
0.5.0 image, then the old image; that deletes any account allowances and puts
the old `core.register_user` back. Nothing was removed from the plugin SDK, so
plugin authors have nothing to migrate. See [Upgrading](README.md#upgrading).


### Added
- **`BOOTSTRAP_OWNER_EMAIL` names the instance owner.** Until now the first
  account to register became the owner, so a new instance that others could
  reach belonged to whoever got there first. Set this variable and only the
  account registered with that address (compared without regard to case)
  becomes the owner, even if other people registered before it; everyone else
  is a member. It never creates a second owner while one exists and never
  changes existing accounts. Unset, nothing changes: the first account is the
  owner. Registration does not verify email addresses, so this does not stop
  someone who knows the address from registering it first; register promptly,
  then set `REGISTRATION_ENABLED=false`. `REGISTRATION_ENABLED=false` still
  takes precedence. In production the API now logs a warning at start-up when
  the instance has no accounts, registration is open and the variable is unset.
  The sample compose file passes it through. Includes a migration that changes
  `core.register_user` and adds `core.instance_has_users()`.
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
- **`@wickermoney/plugin-sdk/server`**, the server-side half of the plugin
  contract, in one place. It exports the types a bundled plugin's `register`
  function is handed (`RouteContext`, `RegisterRoute`, `RouteMethod`, `Query`,
  `RunAsPlugin`), the category-rule types the host injects (`RuleForMatching`,
  `ConditionForMatching`, `RuleSubject`), `PluginRouteError(message,
  statusCode, code, issues?)` for refusing a request the person can fix, and
  `isUuid`. It has no dependencies (no Zod) and is also re-exported from the
  package root. Additive: nothing in the published SDK changed or moved.
- **One UUID rule for plugins.** `isUuid` accepts the canonical hyphenated form
  in either case with an RFC 9562 version (1 to 8) and variant, plus the nil
  and max UUIDs, the same rule the API applies to `:id` params. Every id
  PostgreSQL generates passes; braces, `urn:uuid:`, missing hyphens and
  non-strings do not.
- **`addDays` and `addMonths` in `@wickermoney/plugin-sdk/recurrence`.**
  `addDays(date, days)` and `addMonths(date, months)` work on `YYYY-MM-DD`
  strings with no time zone involved. Both accept negative values.
  `addMonths` clamps to the last day of a shorter month, so Aug 31 plus 6
  months is Feb 28 (Feb 29 in a leap year). Each call clamps on its own, so
  add the total to the original date rather than stepping a month at a time.
  Anything that is not a real calendar date or a whole number throws
  `RangeError`. Also re-exported from the package root. Additive.
- **Stability tiers for the SDK.** The README now lists each entry point as
  `stable` or `experimental`, with who uses it today and what each tier
  promises, and the entry points' module documentation carries the same tag.
  The root, `/runtime`, `/money` and `/server` are stable: a breaking change
  there comes with a `BREAKING CHANGE` footer, a CHANGELOG entry under
  Breaking and a migration note. `/recurrence` is experimental and may change
  in any pre-1.0 minor release; no export was removed from it. A new test lists
  every runtime export of each entry point, so a surface change cannot slip
  through unnoticed. Documentation and tests only: nothing in the published
  SDK changed other than the two helpers above.

### Changed
- **The dashboard asks once for what several widgets share.** The host's
  scoped client now shares identical in-flight `ctx.api.get` calls and keeps
  a resolved one for 5 seconds, per user and never between users, so the
  three monthly-summary widgets make one request instead of three, with no
  plugin changes. Any write drops the user's whole cache, and sign-out or a
  user change clears it. A plugin can force a fresh read with
  `{ cache: 'no-store' }`. Performance only: no API change, no server-side
  cache. See "Request sharing in the scoped client" in `DEVELOPMENT.md`.
- **The transaction list's recurring matches load their data once.** The
  request that shows which transactions settle, are suggested for, or were
  dismissed for a recurring occurrence read the recurring items, records,
  links and tracking starts twice, once to describe occurrences and once to
  find suggestions. It now reads them once for the whole request: 14 database
  statements instead of 20, the same however many recurring items and
  transactions there are. Nothing is kept between requests or shared between
  users. Performance only: no API change and the same results. The new
  `countStatements` test helper and a statement-count integration suite guard
  the recurring read paths.
- **Plugin trust boundary wording.** The docs, SDK comments and `SECURITY.md`
  now say plainly that UI plugins run fully trusted in the app's origin. A
  plugin's `requiredTables` is enforced by PostgreSQL for its server-side code,
  not for its front-end code, and the `x-wickermoney-plugin` header is advisory.
  `PLUGIN_REMOTE_ORIGINS` should stay empty unless you fully trust the origin,
  and third-party plugin install remains unsupported. No behaviour change.
- **The plugin role is described as a guardrail, not a sandbox.** The
  per-plugin PostgreSQL role and the plugin query runner's check stop honest
  mistakes in a bundled plugin's SQL. Crafted SQL (a `DO` block that builds
  `RESET ROLE` at run time) gets past the check and back to the application
  role, which drops the manifest's table limits. Tenant isolation still holds
  there, because the tenant context is signed. `SECURITY.md`,
  `DEVELOPMENT.md` and the code comments now say so. No behaviour change.
- **`sql.raw` is linted.** ESLint now rejects `sql.raw()` outside the
  database layer, keyset paging and tests, so a value cannot be spliced into
  a statement by accident. The one request-time use outside `db/`, the role
  switch for the settings export, now shares `setLocalRole` with
  `asPlugin`, and both `GRANT CONNECT` statements quote the database name
  with `sql.id`. No behaviour change.
- **Bundled plugins share the SDK's server contract.** Budgets and Import CSV
  each carried their own copies of `RouteContext`, `Query` and `RunAsPlugin`,
  an error class and a UUID check, and the two UUID checks disagreed. Both,
  and the API, now use `@wickermoney/plugin-sdk/server`; `BudgetError` and
  `ImportError` extend `PluginRouteError` and behave as before on the wire.
  The API's two `as unknown as` casts around the category rule engine and
  Import CSV's column-map cast are gone. The two plugin packages are private,
  so dropping their re-exports of these types affects no external author.
- **Ids sent to Budgets and Import CSV are checked more strictly.** An id
  PostgreSQL could not have generated (for example a version digit of 0) now
  gets the usual `400` instead of reaching the database. Ids from the app are
  unaffected.
- **A comment that overstated the bundled plugins' trust is corrected.**
  `bundled.ts` said bundled plugins hold no privilege a third-party plugin
  could not request. That is true of their browser half; their server half is
  imported and run by the API.
- **One copy of the date helpers.** The API, the web app, the seed data and
  Budgets each carried their own `addDays`, and the API and seed their own
  `addMonths`. All of them now use the SDK's. Results are the same for every
  valid date, including month-end clamping, negative values, leap years and
  year rollover. The one difference is an impossible date such as `2026-02-30`,
  which used to roll over to March 2 in the API, web and seed copies and now
  throws `RangeError`; every date those callers pass is already validated or
  comes from the server. Budgets' page chunk grows by about 0.7 kB.
- **Old images are pruned.** `package-cleanup.yml` and `preview-cleanup.yml`
  remove old `:edge-<short sha>` tags, old prereleases, untagged versions and
  the preview images of closed or deleted branches. `:latest`, `:next`, `:edge`
  and stable version tags are never deleted. See "Pruning old images" in
  `DEVELOPMENT.md`.
- **Add and fix forms open in the same dialog as Transactions.** On Accounts,
  Categories and Recurring, the add forms no longer sit beside the table, so
  the table gets the full page width. "Add account", "Add category",
  "Add rule" and "Add recurring item" are buttons in the page header, and
  editing a recurring item, fixing an opening balance and resolving a delete
  that has history open in the dialog too (a side drawer on desktop, a
  full-screen sheet on a phone). The dialog closes after a successful save.
  Recurring's History panel is unchanged.

### Fixed
- **The Transactions filter row lines up.** The search box, date pickers,
  selects and the Search and Clear buttons share one height and bottom edge.
  Before, the inputs sat above the buttons, and the "To" error message pushed
  its date picker out of line.

### Migrations

- **027_budget_account_lines** adds `plugin_budgets.account_lines`, one row
  per account allowance per month: a planned amount, a rollover flag and the
  categories it does not count. Row-level security forced, a composite
  `(user_id, account_id)` key to `core.accounts` so a line can never name
  another user's account, and a check that each period is exactly one calendar
  month. Additive. Its `down` drops the table, which discards every allowance.
- **028_bootstrap_owner_email** replaces `core.register_user` so a
  transaction-local setting, passed by the API from `BOOTSTRAP_OWNER_EMAIL`,
  decides who becomes the owner, keeping the advisory lock that stops two
  first registrations both becoming owner. It also adds
  `core.instance_has_users()`. No data changes, and with the variable unset
  the function behaves as before. Its `down` puts migration 026's function
  back and drops the new one.

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

[Unreleased]: https://github.com/WickerMoney/wicker-money/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/WickerMoney/wicker-money/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/WickerMoney/wicker-money/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/WickerMoney/wicker-money/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/WickerMoney/wicker-money/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/WickerMoney/wicker-money/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/WickerMoney/wicker-money/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/WickerMoney/wicker-money/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WickerMoney/wicker-money/releases/tag/v0.1.0
