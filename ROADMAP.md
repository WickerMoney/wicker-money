# Roadmap

Wicker Money is pre-1.0 and has a single maintainer. This is direction, not a
promise: items move, shrink or disappear, and there are no dates.

**Now** is what the next release is working toward. The current release is
`v0.6.1`; see `CHANGELOG.md` for what each tag contains.

## Shipped

| Milestone | What it added |
|---|---|
| M1 | Auth and ledger: users, accounts, categories, rules, transactions, splits, all under row-level security |
| M2 | The shell and the first plugin: Module Federation host, dashboard widgets from plugins, scoped plugin client |
| M3 | Import and categorization: CSV import, category rules with preview, triage tools |
| M4 (`v0.1.0`) | Release readiness and brand identity: self-hosting quickstart, published container image and `plugin-sdk`/`ui-kit`, first-run hardening, `semimonthly` recurrence, the `--wm-` design-token rename, the theme switcher, and a real brand accent and chart palette derived from the logo |
| `v0.6.1` | A patch on `v0.6.0`: an owner confirms in Settings before switching on a third-party plugin (the dialog names its origin and granted tables and repeats the known gaps), the Transactions table and its row actions fit narrower windows, the `Origin-Agent-Cluster` console warning is gone, migration 033 gives the account lines policy the per-statement user lookup, and the frame egress spike is recorded (no control closes the gaps in Chromium 141) |
| `v0.6.0` | UI plugin isolation and owner tooling: a sandboxed frame for plugin UI (Insights and Spending Trends now run in one), plugin-scoped tokens with default-deny routes, an integrity pin and an operator manifest directory for third-party plugins (experimental, no install flow), a hostile-plugin suite in CI, a password-confirmed data export, a Settings danger zone (erase my data, erase this instance), owners changing roles from People, the debt payoff plugin, configurable pool and statement limits with a 100,000-row import cap and paged analyze, merchant and amount sort indexes, lazy core pages and compressed responses, an accessibility sweep, and the API integration suite in CI |
| `v0.5.0` | Plugin platform hardening and account allowances: `plugin-sdk/server` (the host-to-plugin contract in one place), SDK stability tiers and shared `addDays` / `addMonths`, one shared read for dashboard widgets, one data load for recurring matches, `BOOTSTRAP_OWNER_EMAIL`, account allowances on Budgets (a monthly amount against one checking account, with rollover), an honest account of the plugin trust boundary, add and edit forms in the shared dialog, and a lint on `sql.raw` |
| `v0.4.2` | Phone layouts and UI cleanup: a navigation drawer, card layouts for Transactions, Accounts, Recurring and Categories, collapsible Categories and Rules, icon row actions, charts and budget tiles that fit narrow screens. Also the `:edge` image from `main` |
| `v0.4.1` | Two starter categories: Memberships (Subscriptions, everyone's base set) and Domains / web hosting (Technology, with the tech setup question) |
| `v0.4.0` | The plugin manager: owners turn plugins on and off from Settings, applied live, with data kept. Owner and member roles (only the first account is an owner). Matching from the Transactions page and dismissing a suggestion, plus seed data that shows matching. Form errors shown on the field they are about, with structured `issues` from the API |
| `v0.3.0` | Recurring items, the fast follow: paid / landed matching (suggested matches to confirm, per-occurrence skip, move and amount, late occurrences carried forward on matched items), so "Until payday" and the forecast stop counting what already arrived. Also budget windows (one amount for one category across a date range, such as holiday gifts from October 1 to December 25) and a shared exact-money module in `plugin-sdk` (`/money`) |
| `v0.2.1` | Recurring items, Phase B: a Forecast page (bundled plugin) showing each account's projected daily balance from its recurring items over 30/60/90 days, 6 months or to year end. It has a step chart with zero and buffer lines, a first-breach banner, stat tiles, and what moves the line. Also a time zone setting, with the browser's zone taken at sign-up |
| `v0.2.0` | Recurring items, Phase A: a Recurring page for income, bills, debt payments and transfers (items plus per-account legs), the "Until payday" dashboard widget with per-account shortfall warnings and a choice of which accounts count toward safe to spend, buffers editable on the Accounts page, the `plugin-sdk` recurrence module, and transfer `externalId` for duplicate-safe imports |

## Now

After `v0.6.1`:

- Close what the `:edge` soak and the real-device pass turn up.
- Close the known gaps in the plugin frame, which the frame's content security
  policy does not cover in Chromium. The spike found no header, `allow` value or
  CSP directive that closes prerender or WebRTC in Chromium 141 (see
  `SECURITY.md`), so they stay documented. What is left is to re-test when a
  browser ships a control (the CSP `webrtc` directive is only a draft), and to
  stop the frame navigating itself to the app's origin once the server knows the
  address the browser used.

## Next

- Lazy frames: start a widget's frame when it scrolls into view, with a
  handshake timeout that counts visible time, so a long dashboard pays for the
  frames a person actually sees.
- Move the remaining bundled plugins (Budgets, Import CSV, Upcoming, Forecast,
  Debt payoff) into sandboxed frames. They still run in the app's own page.
- A per-process limit on concurrent CSV imports. Ten people committing 50,000
  rows at once held every connection of the default pool for about 45 seconds;
  `DB_POOL_MAX` is the mitigation today (see DEVELOPMENT.md).
- Deep amount-sorted pages in the ledger and merchant search, which the new
  sort indexes do not speed up (about 65 ms and 130 to 165 ms on the largest
  synthetic ledger measured).
- A global per-user rate limit, stricter on import and export. Today only the
  sign-in routes and the password-confirmed actions (erase and export) are
  limited; ordinary data routes are not.
- End-to-end tests of the app's user flows in a browser (the test-pipeline
  plan's T2 to T4). None exist yet: CI runs unit tests, the API integration
  suite and the hostile-plugin suite, and every soak check for a release is
  manual.
- A per-plugin theme contribution point (`contributes.themes` on the plugin
  manifest), so a plugin can ship an additional theme alongside the built-in
  light/dark/system switcher. Also decided, not yet built — do not confuse
  with the global theme switcher already shipped, which is a different,
  simpler thing.

## Later

- Cross-plugin data access: a plugin reading data another plugin owns, for
  example debt details feeding net worth or FIRE, or comparing two budgeting
  plugins side by side. Today a plugin only sees core tables.
- An envelope budgeting plugin, alongside the existing budgets plugin.
- FIRE plugins, one per approach (lean, fat, barista, coast) so they can run side
  by side and be compared, built on a shared calculation module. Each one is kept
  light so several can run without growing the container or server footprint.
  Depends on forecasting.
- Extending the shortfall warning to savings and other accounts, measured
  against each account's buffer amount, for planning larger purchases.
- Editing an occurrence from the calendar widget, and a month grid view.
- Suggesting recurring items by detecting patterns in transaction history.
- Themes as a data-only plugin type (a validated set of design tokens, no code).
- Third-party plugin install: a flow, a catalog and signing. This waits for an
  independent security review of the broker and the plugin-token path, which
  has not happened; the same review comes before any hosted tier or SDK
  freeze. Today an operator
  can add a third-party UI plugin by hand (a manifest with an integrity pin in
  `PLUGIN_MANIFEST_DIR`), and it runs only in a sandboxed frame with the table
  reads it is granted. It has no server-side code: that needs a connection
  boundary the project does not have, so it stays first-party only. Some
  bundled plugins still run in the app's own page until they are ported.
- Caching layers beyond the per-user response cache, and an authentication
  lookup cache. Unmeasured, and the performance sweep reduced the need; revisit
  with numbers.
- Hosted-readiness: concurrent index builds, `NOT VALID` foreign keys with a
  later validate, batched backfills, asynchronous import jobs and a per-tenant
  plugin registry cache. Nothing here helps a self-hoster, and a hosted tier is
  undecided.
- Freezing the plugin API (`SDK_MAJOR_VERSION`) ahead of 1.0. The plugin SDK's
  entry points now carry stability tiers (see its README); the freeze applies
  to the stable ones.
