# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

GitHub release notes are generated from commit subjects; this file is the
curated, human-readable version.

## [Unreleased]

### Changed

- **Transactions and Recurring say what an action did in a toast, not in the
  page banner.** Deleting a transaction now says what was deleted ("Deleted
  'Coffee' (-$4.50)."; a transfer says both sides were removed), and so do
  saving an edit, setting a category, bulk categorize ("12 transactions
  updated."), matching, unmatching, *Not this* and *Restore*, and on Recurring
  adding, updating, ending and deleting an item, confirming or dismissing a
  suggestion, and skipping, moving or matching an occurrence. A refused row
  action is an error toast. Nothing offers Undo and nothing closes itself; a
  repeat of the same kind of action replaces the last toast. The page banner is
  now only for a list that failed to load, and a form's own problems stay on the
  form.
- **The Transactions recurring column is quieter.** A matched row shows its
  recurring item as a pill with an *Unmatch* button, and the occurrence's date
  only when it is not the transaction's own; an unmatched row shows nothing
  there. A **Link** button, first among the row buttons (accent colour and a dot
  when an item is suggested), opens a list under the row with the suggestion
  (*Match*, *Not this*), the other items it could be, the dismissed ones
  (*Restore*) and *Close*. Not this, Restore and Unmatch keep the list open.
- **The API now has a per-user rate limit, on by default.** Every signed-in
  user may make 600 requests a minute to `/api/v1`, 30 CSV import requests
  (`analyze` and `commit`) and 5 data exports; a request with no valid token
  counts against the client address. Over the limit the API answers `429
  rate_limited` with a `Retry-After` header, and the app shows the message. A
  heavy normal session makes under a seventh of the general limit, so people
  using the app will not meet it. **Upgrade note: anything that calls the API in
  a loop (a sync, a poller, a script) may now get 429s. Raise
  `API_RATE_LIMIT_MAX` (and `API_RATE_LIMIT_IMPORT_MAX`,
  `API_RATE_LIMIT_EXPORT_MAX`), or set `API_RATE_LIMIT_ENABLED=false` to turn
  the limit off.** The counters are per API process, so several instances each
  count on their own. The sign-in limits are unchanged. See `DEVELOPMENT.md`,
  "API rate limit".
- **The Forecast page runs in a sandboxed plugin frame**, the first page to do
  so, like Insights and Spending Trends do for their widgets. The page looks and
  behaves as before: the frame grows to its content and the window scrolls, Tab
  order and the skip link are unchanged, and the tab title is the app's. Tab at
  the last control of a frame now leaves it instead of staying put. Plugin page
  routes also match addresses under the page (`/p/<id>/<page>/...`), which a
  page in a frame is told about.
- **Plugin frames start when they scroll into view.** A dashboard widget that
  runs in a sandboxed frame no longer gets its iframe until its card is within
  600 px of the viewport; until then the card holds a placeholder of the frame's
  minimum height. Frames in the first screen start at load, as before, and a
  browser without `IntersectionObserver` starts every frame at load. A started
  frame is kept when scrolled away. The "plugin did not start in time" clock now
  starts when the frame is created and stops while the tab is hidden, so a tab in
  the background no longer fails a widget. Find-in-page and printing only see
  frames that have started.
- **Upcoming runs in a sandboxed frame.** The "Until payday" widget no longer runs in the app's own page; it reads through the host's broker with only its two read grants, and its upcoming list scrolls inside the widget.
  
### Added

- **`Table` can show a detail row under a row** (`@wickermoney/ui-kit`,
  experimental): the optional `rowDetail(row)` prop renders a full-width row
  directly under the row it belongs to. `IconButton` also draws a `link` icon.
- **Debt payoff: leave a debt out of the plan.** Each debt has an "In plan"
  switch, saved as soon as you change it, like "safe to spend" on Accounts. A
  debt that is switched off stays in your list, muted and marked "Not in plan",
  but is left out of the chart, the schedule, the totals, the pooled payment and
  the debt-free date, so one very large debt, a mortgage say, no longer flattens
  the rest. The headline and the dashboard widget say what they leave out
  ("Debt free (excluding Mortgage) on ..."). It still counts toward the limit of
  50 debts. Archiving is unchanged and still removes a debt from everything.
- **Debt payoff: an extra amount for one debt.** Each debt can have its own
  monthly extra, paid after the minimums and before the shared extra is spread by
  your strategy. It comes on top of the shared extra and does not join the pool,
  so when that debt is paid off its extra stops instead of moving to another
  debt, and the debt-free date moves later. Freed minimums still roll over as
  before. The shared extra is relabelled "Extra for all debts (follows the
  strategy)". A debt with no extra and every debt in the plan give exactly the
  plan they gave before.
- **End-to-end tests (`e2e/`).** A private Playwright package that drives the
  built image through a throwaway compose stack with the seeded demo data:
  `e2e/run.ps1` on Windows, `e2e/run.sh` elsewhere, `pnpm test:e2e` against a
  stack you already run. Seven smoke specs cover start-up, sign-in, the
  dashboard widgets and plugin pages, tenant isolation and adding a
  transaction. It is not part of `pnpm test`, adds no browser download to
  `pnpm install`, and the shipped image is unchanged. See `DEVELOPMENT.md`,
  "End-to-end tests".
- **A notification toast in `@wickermoney/ui-kit`** (experimental, for the core
  app only for now): `ToastProvider`, `ToastViewport` and `useToast()`, plus the
  `--wm-shadow-raised` token. Nothing dismisses itself: a toast stays until it is
  closed (its button or Escape) or replaced by the same key. A polite screen
  reader announcement is separate from the visible banner, which sits at the top
  of the page content and stays in view under the phone bar. The app shell now
  draws it; no page raises one yet.
- `pnpm --filter @wickermoney/web test:toast`, a browser check with axe for the
  toast (light and dark, desktop and phone widths, drawer, dialog, reduced motion).
- **A limit on concurrent CSV imports.** Each commit holds a database connection
  for its whole length, so a few large files at once could take every
  connection and make the rest of the app fail waiting for one (ten people
  committing 50,000 rows each, on a pool of 10: most other requests failed for
  about 40 seconds; with the limit, none did). The API now commits at most
  `IMPORT_MAX_CONCURRENT` imports at once per process (default: half of
  `DB_POOL_MAX`); another waits its turn without holding a connection, for up to
  `IMPORT_QUEUE_WAIT_SECONDS` (default 30), and is then refused with `503`
  `import_busy` and a `Retry-After` header; nothing is imported and the page
  shows the message, and sending the same file again imports it once. One person
  importing alone is not slowed. See `DEVELOPMENT.md`, "Pool, timeouts and import
  limits".

### Fixed

- **Phone layout: text buttons overlapped their neighbours.** On a phone,
  "Match…" in the Transactions recurring column sat on top of the line below it,
  and "Unmatch" touched the date before it; the Recurring page's "Undo" had no
  tap area. The 560 px rule for the bigger tap area was cancelled by a later
  rule, leaving only its negative margin.
- **Erase my data and a write in flight.** A write that was open when the erase
  started was invisible to it and committed afterwards, leaving a row for the
  signed-out user (or, for a row pointing at an account, failing the erase with
  a 500). The erase now locks the account row first and waits for open writes.
  A request that had already passed its session check and writes after the erase
  can still leave one row; the next erase removes it, and the limit is
  documented in `DEVELOPMENT.md`.
- The plugin frame no longer sends `X-Frame-Options`, which Firefox logged as
  ignored in favour of `frame-ancestors` once per framed widget; every other
  response keeps it.
- **Plugin widgets in `pnpm dev`.** Insights and Spending Trends showed "The
  plugin did not start in time" in development, with CORS errors in the console
  for `/@vite/client` and the frame's other modules. Vite was answering
  `/plugin-frame` with its own HTML and no policy, and a sandboxed frame's
  opaque origin cannot load Vite's modules. The dev server now proxies the frame
  (`/plugin-frame`, `/assets` and a frame's `/plugins` requests) to the API, so
  the frame has the same policy, sandbox and CORS headers as in production. This
  needs a built web app and `WEB_DIST_DIR` set for the API in development; the
  console names the cause when a frame still fails to start. Nothing changes in
  production, and the frame's policy and sandbox are untouched.
- **`pnpm dev` failing on Windows with `EPERM` in a plugin's `dev` script.** Each
  bundled plugin's `build` and `dev` tasks ran at the same time and both wrote
  `apps/web/public/plugins/<id>`, and the `dev` script starts by deleting that
  folder. Windows refuses to delete a folder another process is writing into, so
  Insights, Spending Trends and others failed on some runs and not others. A
  plugin's `dev` now waits for its own `build` (a `turbo.json` in each plugin),
  and the delete retries a few times.

### Migrations

One new migration, so an upgrade runs one more step. **Back up your database
before upgrading** (`pg_dump -Fc`); going back is `node dist/db/cli.js down` once
with the newer image, then start the older image.

- **034_debt_payoff_plan_controls** adds `included boolean not null default true`
  and `extra_payment numeric(19,4) not null default 0` (never negative) to
  `plugin_debt_payoff.debts`. Existing debts are all in the plan with no extra, so
  nothing changes until you use them. Its `down` drops both columns, which
  discards any switch and extra amounts you set.

## [0.6.1] - 2026-10-23

A small patch: an owner is asked before a third-party plugin is switched on, the
Transactions table fits narrower windows, the browser console and DevTools
Issues stop warning about the plugin frame, and one more policy gets the
per-statement user lookup. It has one new migration, 033, which changes no
access and has nothing to undo. The owner plugin list also gains two read-only
fields; see Added. **Back up your database before upgrading** (`pg_dump -Fc`),
as for any release. See [Upgrading](README.md#upgrading).

### Added

- Settings asks an owner to confirm before switching on a plugin that is not
  bundled, naming the origin it loads from and the tables it is granted and
  repeating the sandbox's known gaps; bundled plugins and switching off do not
  ask. The question is in the Settings page only: a request sent straight to the
  API does not ask. The owner plugin list gains `origin` and `tables`, and the UI
  kit `Dialog` an optional `describedBy`.
- **An additive API change in a patch release.** `GET /api/v1/plugins/registry`
  (the owner plugin list) now returns two more fields on each plugin: `origin`
  (the origin its remote entry loads from, or `null` for this instance's own
  origin or when there is no usable manifest) and `tables` (the core tables its
  manifest lists, sorted; empty when there is no usable manifest). No existing
  field changed or moved, so a client that ignores fields it does not know is
  unaffected. The `Dialog` prop is optional, so existing callers are unaffected.

### Changed

- **The Transactions table fits the room it has.** From the phone layout (560px)
  up, the date never wraps, the Edit and Delete buttons are always in view and
  neither the table nor the page scrolls sideways. With about 880px of room (a
  window roughly 1170px wide, with the sidebar) it is still the seven-column
  table, and a long category name no longer takes the merchant's room; with
  less, each row is three lines (merchant and amount, date and category,
  recurring match) with the buttons in a column beside them. Every column is
  still there, in the same order, and the header row is hidden as on a phone.
  The page used to scroll sideways below about 1190px because the hidden
  "Actions" header label sat outside the table's scroller; `Table` now clips it.

### Fixed

- **No more `Origin-Agent-Cluster` warnings in the browser console.** Chromium
  logged "could not be origin-keyed" once for each plugin frame on a dashboard,
  over HTTPS as well as plain HTTP. A sandboxed frame has an opaque origin and
  cannot be origin-keyed, and the API sent `Origin-Agent-Cluster: ?1` on every
  response, the frame document included. The API no longer sends the header.
  Chromium still origin-keys the app's own page by default, and nothing about the
  frame's sandbox changes.
- **No more "blocks the use of `eval`" issues for the plugin frame.** Chrome
  DevTools listed a Content Security Policy violation for the frame's script and
  the Spending Trends widget on every dashboard. zod makes a `new Function("")`
  check when it builds its first object schema, the policy refuses it, and zod
  falls back to its ordinary parser, so nothing broke. The app's page already
  turned that check off; the frame now does too, before any plugin loads, and a
  plugin built with its own zod 4.4 or later follows it. The policy and the
  sandbox are unchanged, and the hostile suite still checks that `eval` and
  `new Function` are refused. A browser check now loads the bundled widgets and
  fails on any eval violation.

### Migrations

One new migration, so an upgrade runs one more step. It changes no access and
locks nothing on a database where it has nothing to rewrite.

- **033_tenant_lookup_policies** rewrites any policy in `core` or a `plugin_*`
  schema that still calls `core.current_user_id()` bare to
  `(SELECT core.current_user_id())`, so the lookup runs once per statement, not
  once per row. A database migrated in order has one: `account_lines_isolation`
  (027 created it after 018's rewrite). It returns the same rows, does nothing
  and locks nothing where none is left, and its `down` does nothing.

## [0.6.0] - 2026-10-16

Plugin isolation, owner tooling and a performance and accessibility sweep. A
plugin's interface can now run in a sandboxed frame that holds no session, cookie
or page access and reaches data only through the host, with a short-lived token
that carries just the plugin's grants; Insights and Spending Trends run that way,
and an operator can add a third-party UI plugin by hand (experimental, no install
flow). The data export now asks for the password again, a danger zone erases your
data or the whole instance, owners change roles from Settings, and a debt payoff
plugin joins the bundled set. **Back up your database before upgrading:** this
release has four migrations, 029 to 032. All four have a `down`, so going back to
0.5.0 is `node dist/db/cli.js down` four times with the 0.6.0 image, then the old
image; that deletes everything in the debt payoff plugin and drops the owner-role
and erase functions and the two ledger indexes. Two changes can break callers: the
export is now two requests, and the Import CSV `analyze` response is paged. The
SDK root also stopped exporting the Zod manifest schemas. See
[Upgrading](README.md#upgrading).

### Breaking
- **The data export needs a password-confirmed ticket.**
  `GET /api/v1/settings/export` now answers `403 export_confirmation_required`
  unless the request carries an `x-wickermoney-export-ticket` header. Get one from
  the new `POST /api/v1/settings/export-ticket` with `{ "password": "..." }`, which
  returns `{ ticket, expiresAt }`. A ticket is good for one download, for two
  minutes, for that user in that session; an unknown, expired, used or someone
  else's ticket is `403 export_ticket_invalid`. A wrong password is
  `403 password_incorrect` (not `401`, so the web app does not read it as an
  expired session) and counts against the attempt limit the erase actions already
  use. Tickets are held in the API process's memory, so a restart drops them, and
  several API processes behind one address need the two requests to reach the
  same one. **Migration:** the Settings page asks for the password in a dialog and
  makes both requests. A script that calls the export itself must make them in
  order. A plugin token cannot reach either route.
- **Import CSV's `POST /analyze` no longer returns every row.** The response is
  still `{ summary, errors, rows, flagged }`, but `rows` is now the first 100 rows
  of the file, and the rows that need review come back as
  `flagged: { total, offset, rows }`, a page of up to 500. Send `flaggedOffset`
  and `flaggedLimit` (at most 1000) for another page; each such request sends and
  analyses the file again. For an 8 MB file the response went from about 21 MB to
  19 KB. `commit` classifies the file itself, so rows that were not returned are
  imported as the user decided. **Migration:** a client that read every row from
  `rows` must page `flagged`. The Import CSV page in the app already does.
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
- **Admission control for plugins the image did not ship (ADR 0005).** A
  manifest can carry an `integrity` map of Subresource Integrity values, keyed by
  file path relative to the plugin's directory. A plugin that is not bundled, or
  whose entry the host does not serve itself, must have one that lists its entry
  file; the sandboxed frame has the browser verify every listed file before the
  plugin runs, and a changed file is refused with a reason. It covers only the
  listed files, not stylesheets, and was tested in Chromium 141 only. SDK:
  `parseIntegrity` and `checkRemoteEntryIntegrity`.
- **`PLUGIN_MANIFEST_DIR`: a minimal operator-side manifest source.** A directory
  of `*.json` manifests read once at start-up. Each is checked like any
  manifest, registered switched off, and run only in a frame. There is still no
  install flow, catalog or signing. A manifest that declares `endpoints` or
  `exporters`, a permission the host does not implement, an origin that is not in
  `PLUGIN_REMOTE_ORIGINS`, or no pin is refused, and the reason is listed with the
  plugin. A third-party plugin has no server code, storage or scheduled work.
- **`@wickermoney/plugin-sdk/isolated`, the contract for UI plugins that run in a
  sandboxed frame (experimental).** A `PluginContext` is an object of functions
  and cannot cross a frame boundary, so this entry point defines a message
  protocol (version 1) over a `MessagePort` instead: `request` for `GET`,
  `POST`, `PUT` and `DELETE` with a plugin-visible error (`code`, `status`,
  `issues`), `navigate`, `resize`, `focus-out`, a reserved `notify`, and from
  the host `init`, `response`, `theme`, `locale`, `props`, `route` and
  `focus-in`, after a `wm.hello` / `wm.connect` handshake that carries the
  protocol version. It includes validators the host runs on every frame message
  (`parsePluginMessage`) and an in-frame client, `connectToHost`, that rebuilds
  the same `PluginContext` so a component written against `/runtime` runs in
  either place. It is additive: `SDK_MAJOR_VERSION` stays `0`, `/runtime` is
  unchanged and no existing manifest needs editing. The web app hosts it (next entry),
  and it stays experimental until the isolation work has shipped and settled.
- **The web app can run a UI plugin in a sandboxed frame.**
  A plugin that is not in-realm renders in `<iframe sandbox="allow-scripts">`
  (never `allow-same-origin`), loaded from a new `GET /plugin-frame` document
  that the API serves with its own CSP (`sandbox allow-scripts; default-src
  'none'; connect-src 'none'`). A broker in the host page is the only code that
  holds a plugin token: it checks the manifest grants and a path allow-list,
  then the per-user response cache, then the network, and rate-limits and
  validates every message. The host owns the frame's width and clamps the height
  it reports, pushes theme and locale changes, and takes keyboard focus when it
  leaves the frame. `GET /api/v1/plugins` now reports each plugin's `runtime`
  (`in-realm` or `isolated`) beside its manifest; the list of bundled plugins
  that still run in the page is a host-internal set, not a manifest field. Insights
  and Spending Trends are the bundled plugins that have moved out of it (see
  Changed); the other five run in the page as before. There is still no
  install flow for third-party plugins. See `DEVELOPMENT.md` "Isolated
  plugin frames".
- **An optional `isolated` flag on the plugin manifest.** `isolated: true`
  declares that a plugin was built for the isolated runtime. It is not a grant:
  it can only move a plugin towards isolation, and the host decides which
  runtime a plugin gets. Absent means `false`, so existing manifests are
  unaffected.
- **Plugin-scoped access tokens, and default-deny for them (server side).**
  `POST /api/v1/plugins/:pluginId/token` mints a five-minute token that speaks
  for one plugin: its own audience, the plugin id and the plugin's granted
  tables as claims, bound to the session it was minted under. A plugin token can
  reach only the `GET /api/v1/core/*` reads its plugin was granted and its own
  `/api/v1/p/<id>/` routes. It is refused (`403 plugin_route_denied`) on
  everything else: sign-in and refresh, the data export, settings, plugin
  management, the host's own data routes and other plugins' routes. Every
  `/api/v1` route is classified in `apps/api/src/auth/pluginRouteAccess.ts`, a
  route left out is denied, and a test fails when one is. The web app uses them
  only for plugins that run in a frame; plugin code in the host page is not
  sandboxed. See `DEVELOPMENT.md` "Plugin tokens".
- **Owners can change another account's role from Settings → People.** The
  section lists every account with a role select. Promoting a member makes a
  second owner; demoting an owner asks for confirmation. The last owner cannot
  be demoted, and an owner can step down only while another owner remains.
  Members never see the section. A change applies on that account's next
  request. New owner-only routes: `GET /api/v1/users` and
  `PATCH /api/v1/users/:id/role`. Nothing about an account other than its
  email, role and creation time is returned.
- **Debt payoff plugin.** A new bundled plugin,
  `wickermoney.debt-payoff`, with its own tables (migration 030), endpoints for
  debts and settings, and a snowball and avalanche planner behind
  `GET /api/v1/p/wickermoney.debt-payoff/plan`. The plan is computed exactly in
  integer units of 0.0001, interest compounding monthly at APR/12 and rounded
  once per debt per month, half away from zero; it stops at 600 months and says
  so. It also appears in the settings export. A "Debt payoff" page lists your
  debts, adds and edits them, and shows the plan with a chart (and a table view
  of it); a dashboard widget shows the debt-free date and the next debt in line.
  The plugin can read your accounts so a debt can track a loan or credit card,
  and nothing else of the host's.
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
- **A danger zone at the bottom of Settings, with two separate erase actions.**
  - **Erase my data** is for every account. It deletes the signed-in user's rows
    from every core table and every plugin schema (including a plugin that is
    switched off, because switching one off keeps its data) and ends all of their
    sessions. The password and the typed phrase `erase my data` are required, and
    the dialog offers the data export first. **The account row is kept**, so the
    person can sign in again with an empty account; deleting the login as well is
    a different action and is not part of this one.
  - **Erase this entire instance** is for an owner. It empties every account and
    every plugin schema for everyone, signs everyone out, and leaves an instance
    that registers a first owner again. It sits in its own section with its own
    dialog, needs the owner's password and the phrase `erase this instance`, shows
    the database name, and refuses while other sessions are live unless they are
    acknowledged. It also refuses when the instance could not set up an owner
    again: `REGISTRATION_ENABLED=false`, or `BOOTSTRAP_OWNER_EMAIL` naming an
    address other than the erasing owner's. Which plugins are switched on is kept.
  - New endpoints: `POST /api/v1/settings/erase-my-data`,
    `GET` and `POST /api/v1/settings/erase-instance`. A wrong password is `403`
    `password_incorrect`, not `401`, so the web app does not treat it as an expired
    session. Both are rate limited per user.
  - **A table that holds user data but is not in the erase plan stops the erase**
    (`500 erase_unplanned_tables`, nothing deleted) and fails a test that lists
    every table with a `user_id` column. See "Erasing data" in `DEVELOPMENT.md`.
    No plugin SDK entry point was added.
- **`AuthService.confirmPassword`**, a reusable "type your password again" check.
  The erase actions and the data export use it.
- **Configurable database limits and import cap.** Four new settings (see
  `DEVELOPMENT.md`, "Pool, timeouts and import limits"), all with the old
  behaviour as their default except the import cap and the longer limit for
  import and export routes (they ran under the 30 s limit before):
  - `DB_POOL_MAX` (default `10`, 2 to 200): connections the API may hold open.
  - `DB_STATEMENT_TIMEOUT` (default `30000`, milliseconds, 1000 to 3600000): the
    longest one statement may run. The floor is deliberate, so `30` is rejected
    rather than read as seconds.
  - `DB_LONG_STATEMENT_TIMEOUT` (default `300000`, never below the one above): the
    same limit for CSV import and the data export only, set per transaction.
  - `IMPORT_MAX_ROWS` (default `100000`, 1 to 1,000,000): data rows one import may
    contain, counting unreadable ones. It was a fixed 50,000. The 8 MB file limit
    still applies and is not configurable.
- **Why 100,000 rows.** An 8 MB file holds about 109,000 bank-style rows, 67,000
  with a memo column and 374,000 rows of minimal text, so the size limit alone
  does not bound the work. Measured on two vCPUs with a local PostgreSQL 16 and a
  pool of 10: 100,000 rows analysed in about 1 s and committed in about 17 s
  (API memory up about 190 MB while analysing and 110 MB while committing, the
  event loop stalled 0.7 to 0.8 s); 373,585 rows committed in 48 s. Commit time is
  linear, about 150 microseconds a row, and is how long a pooled connection and
  the account's import lock are held. These are one machine's numbers; lower the
  cap on a small device. **Concurrent imports share the pool:** ten simultaneous
  50,000-row commits held all ten connections for about 45 seconds, and 8 of 106
  other requests made meanwhile failed waiting for a connection; with
  `DB_POOL_MAX=20` none did. If several people import at once, raise the pool and
  check PostgreSQL's `max_connections`. The full table is in `DEVELOPMENT.md`.
- **PgBouncer in transaction mode works with one change.** Tested with
  PgBouncer 1.22.0, `pool_mode = transaction` and the full integration suite
  through it (1,011 of 1,014 tests passed). The API sends `statement_timeout` and
  `idle_in_transaction_session_timeout` as startup parameters, which PgBouncer
  refuses, so add `ignore_startup_parameters = statement_timeout,idle_in_transaction_session_timeout`
  to `pgbouncer.ini`. Those two limits then stop applying through the pooler;
  set them on the database role instead (steps in `DEVELOPMENT.md`).
  `DB_LONG_STATEMENT_TIMEOUT` still applies. The three failing tests check the
  pool's own default limit, which is that ignored parameter. Session and statement
  modes, other versions and any production load were not tested.
- **`longRunning` for plugin routes.** `RegisterRoute`'s options in
  `@wickermoney/plugin-sdk/server` take `longRunning: true`, which runs the
  route's database work under `DB_LONG_STATEMENT_TIMEOUT` instead of the ordinary
  limit. Import CSV's analyze and commit use it. Additive.
- **Merchant and amount sort indexes (migration 031).** The transaction list pages
  by `(sort column, id)`; merchant had no index at all, so every merchant page
  sorted the user's whole ledger. Measured on PostgreSQL 16 with 1,000,000
  transactions across 50 users and row-level security as in production: merchant
  pages for the largest user (222,000 rows) went from 52 to 78 ms to about 0.2 ms,
  and the first page of an ascending amount sort from 2.5 to 0.2 ms warm (118 to
  148 ms to 2 to 4 ms cold). **Deep amount-sorted pages are not faster** (about
  65 ms at 220,000 rows), because PostgreSQL cannot use a numeric comparison as an
  index bound under row-level security, and `ILIKE` merchant search is unchanged
  (130 to 165 ms for the largest user). Deep category-and-date pages got 8 to
  15 ms slower. The indexes are built with a plain
  `CREATE INDEX`, which blocks writes to transactions while each builds: about
  1.3 s and 1.2 s on 1,000,000 rows. The synthetic ledger is not a real one.
- **What a frame costs.** A frame is a browser process and a copy of React, so a
  frame per widget has a price (Chromium 141, headless, medians; one machine, not
  a benchmark). On a test fixture each frame after the first cost about 9 MiB and
  150 ms (one frame loaded in 757 ms, six in 1,506 ms). The first frame costs more
  because it starts its own renderer process: Insights' two widgets added about
  377 ms to the first widget and 152 MiB of browser memory on the real dashboard
  (717 ms and 765 MiB in the page, 1,094 ms and 917 MiB in frames), and Spending
  Trends alone about 100 ms and 130 MiB, each further frame about 6 MiB and
  150 to 180 ms. A projection with both plugins in frames (three frames) loaded in
  1,606 ms and used 927 MiB, against 1,152 ms and 782 MiB in the page. Frames do
  not make the dashboard cheaper; they buy the boundary with time and memory.
- **A hostile-plugin test suite runs in CI.** A plugin written to misbehave is
  run against the real API and Chromium on every pull request, in its own job
  (Hostile plugin suite): 121 server tests, 141 browser attacks in 25 checks, and a remote-origin
  check that drives a real build through the integrity pin (15 checks). It covers
  forged, expired and foreign tokens, every denied route class, a flooding or
  malformed message, spoofed senders and frame navigation. It cannot show that a
  browser has no other way out; see "Known gaps" in `SECURITY.md`.
- **The API integration suite runs in CI.** The API's `*.integration.test.ts`
  files (row-level security, plugin roles, tenant context, migrations) need a real
  PostgreSQL, and `pnpm test` leaves them out, so nothing in CI ran them: not a pull
  request, not the `:edge` image, not a release. A new job, **API integration
  (Postgres 16)**, runs them against `postgres:16-alpine` on every pull request and
  every push to `main`, and the `:edge` and release workflows run it before they
  build an image, so a red suite stops all three. PostgreSQL 16 is the only version
  the suite supports. See "What CI runs" in `DEVELOPMENT.md`, which also has the
  steps to run it locally.

### Changed
- **What the sandbox protects, and what it does not, is stated plainly.**
  `SECURITY.md`, `DEVELOPMENT.md` and the SDK README now say that the sandboxed
  frame keeps a plugin away from the user's access token, the refresh cookie, the
  page's DOM and storage, other plugins' routes and everything the server denies
  to a plugin token, and that script in the frame cannot call `fetch`, XHR,
  WebSocket or beacons. They also say what it does **not** stop. The frame's
  content security policy does not govern `<link rel=prerender>` or WebRTC (STUN
  and TURN) in Chromium, so a hostile plugin can make a browser request to an
  address it picks and carry what it holds in the URL or the TURN username; a
  sandboxed frame can navigate itself to a same-origin URL the page's frame policy
  allows (in Chromium 141 that request carried no credentials and returned nothing
  to the plugin, but WebKitGTK 2.52 sent a `SameSite=Strict` cookie on it; Firefox
  and Safari were not tested). A malicious plugin can therefore cause some
  credential-less requests and read nothing back, and a plugin granted your
  transactions can send them to another server through those gaps. These are
  documented known limitations, not vulnerabilities; a new channel of the same
  kind, or the same one in another browser, is in scope for a report. The isolated
  runtime and third-party plugin loading are **experimental**, off by default and
  opt-in, and the broker and token path have not been through an independent
  security review. Five bundled plugins still run in the app's own page and are
  fully trusted.
- **A remote plugin origin has no path into the app's page.** The page's own
  content security policy no longer lists `PLUGIN_REMOTE_ORIGINS`; only the
  sandboxed frame's does, and the page's loader refuses to register a remote
  entry whatever runtime the server reports. `PLUGIN_REMOTE_ORIGINS` is still
  empty by default and start-up is unchanged when it is.
- **A manifest that declares `network:outbound`, `schedule:daily` or `notify` is
  refused at load**, with a reason on the plugin list. The host implements none
  of them. (Previously they loaded and were ignored.)
- **The Insights widgets run in sandboxed frames.** "Money in and out" and
  "Where it went" now render in `<iframe sandbox="allow-scripts">` behind the
  broker instead of in the app's own page, so Insights code can no longer reach
  the user's session, cookies or the rest of the page. What a person sees is
  the same, with two differences: the first widgets take a little longer to
  appear because each frame loads its own copy of React, and the chart's table
  view scrolls inside the widget (400 px) instead of making it as tall as the
  range. Budgets, CSV import, Upcoming, Forecast and Debt payoff are unchanged
  and still run in the page. Spending Trends moves in the next entry.
- **The Spending Trends widget runs in a sandboxed frame.** Its code is
  unchanged: it was written against `PluginContext` alone, and the frame rebuilds
  the same context. It has no page, only the dashboard widget. The same
  below-the-fold and loading-time differences as Insights apply.
- **The Insights trend tooltip stays inside the chart.** On the first and last
  month it used to hang past the chart's edge (and was cut off by the card on a
  phone).
- **The Insights trend widget is 85 kB smaller.** It imported one function from
  the SDK root, which pulled the Zod manifest schemas into the widget. It now
  carries its own copy of the month arithmetic, checked against the SDK's by a
  test.
- **`x-wickermoney-plugin` is no longer an identity.** A request is attributed
  to a plugin by its plugin token. The header is ignored on such a request, and
  on the host's own token it can only hold the request to the named plugin's
  manifest, as before. First-party plugins that run in the host page still send
  it; it was never a security boundary and still is not. A request with the
  host's own token and no header is allowed, as before; only a plugin token is
  held to a plugin's grants.
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
- **Sandboxed widget frames below the fold get their height without scrolling.**
  Chromium does not run a cross-origin frame's rendering updates while it is off
  screen, so `ResizeObserver` never fired there and the frame stayed at the
  host's 96 px minimum until it was scrolled into view. `observeSize` in the
  plugin SDK now also re-reads the height every 250 ms (a repeat of the same
  height sends nothing) and works where there is no `ResizeObserver`. Plugins
  that call `observeSize` get the fix without changes.
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
- **Isolated frames are transparent inside their card.** A plugin frame showed
  as a box in the page background colour inside the card, and as an opaque canvas
  in dark mode. The frame's `html` and `body` are now transparent and the host
  iframe inherits the page's colour scheme, which the frame is told as well.

### Migrations

**Back up your database before upgrading** (`pg_dump -Fc`). Going back to 0.5.0
without restoring is `node dist/db/cli.js down` four times with the 0.6.0 image,
then start the 0.5.0 image. Each `down` undoes only its own migration.

- **029_owner_role_management** adds `core.list_users_for_owner()` and
  `core.set_user_role(uuid, core.user_role)`, `SECURITY DEFINER` functions that
  only the application role can execute. They check that the caller is an owner,
  refuse to demote the last owner, and take the lock registration uses so two
  owners demoting each other at once cannot leave none. No data changes.
  Registration is unchanged. Its `down` drops both functions and leaves assigned
  roles as they are.
- **030_plugin_debt_payoff** creates the `plugin_debt_payoff` schema with `debts`
  and `plan_settings`: row-level security forced, `numeric(19,4)` money, the APR
  as `numeric(7,4)`, and a debt's account link as a composite
  `(user_id, account_id)` key that is cleared (not cascaded) when the account is
  deleted. No existing data changes. Its `down` is `DROP SCHEMA
  plugin_debt_payoff CASCADE`, **which deletes every debt and plan setting**.
- **031_ledger_sort_indexes** adds `ix_transactions_user_merchant_id` and
  `ix_transactions_user_amount_id` on `core.transactions`. It runs outside a
  transaction and is safe to re-run. Each plain `CREATE INDEX` blocks writes to
  transactions while it builds (about 1.3 s and 1.2 s on 1,000,000 rows); a much
  larger ledger is better served by building them `CONCURRENTLY` first. Its `down`
  drops both indexes. It leaves `ix_transactions_user_amount` (migration 015) in
  place.
- **032_erase_instance** adds `core.erase_instance()` and
  `core.instance_activity(uuid)`, `SECURITY DEFINER` functions that only the
  application role may run and that refuse anyone who is not an owner right now.
  `erase_instance` truncates `core.users`, every core table with a `user_id` and
  every table in a `plugin_` schema, in one statement without `CASCADE`, so a
  table outside that list that still references one inside it makes the erase
  fail and roll back. `instance_activity` counts live sessions and accounts other
  than the caller's. No data changes when it runs. Its `down` drops both
  functions; an erased instance stays erased.

**Order matters.** Kysely refuses a pending migration whose name sorts before one
already applied, so any later migration is 033 or higher.

**Development databases only.** This migration was first numbered
`031_erase_instance` on a branch. A database that applied it under that name has a
row Kysely no longer finds, and the migrator will refuse to run. Before migrating,
delete that row and the two functions it created:

```sql
DELETE FROM public.kysely_migration WHERE name = '031_erase_instance';
DROP FUNCTION IF EXISTS core.erase_instance();
DROP FUNCTION IF EXISTS core.instance_activity(uuid);
```

An installation that went from 0.5.0 to a tagged release never had that name.

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

[Unreleased]: https://github.com/WickerMoney/wicker-money/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/WickerMoney/wicker-money/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/WickerMoney/wicker-money/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/WickerMoney/wicker-money/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/WickerMoney/wicker-money/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/WickerMoney/wicker-money/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/WickerMoney/wicker-money/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/WickerMoney/wicker-money/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/WickerMoney/wicker-money/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/WickerMoney/wicker-money/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/WickerMoney/wicker-money/releases/tag/v0.1.0
