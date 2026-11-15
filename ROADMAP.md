# Roadmap

Wicker Money is pre-1.0 and has a single maintainer. This is direction, not a
promise: items move, shrink or disappear, and there are no dates.

**Now** is what the next release is working toward. The current release is
`v0.8.0`; see `CHANGELOG.md` for what each tag contains.

## Shipped

| Milestone | What it added |
|---|---|
| M1 | Auth and ledger: users, accounts, categories, rules, transactions, splits, all under row-level security |
| M2 | The shell and the first plugin: Module Federation host, dashboard widgets from plugins, scoped plugin client |
| M3 | Import and categorization: CSV import, category rules with preview, triage tools |
| M4 (`v0.1.0`) | Release readiness and brand identity: self-hosting quickstart, published container image and `plugin-sdk`/`ui-kit`, first-run hardening, `semimonthly` recurrence, the `--wm-` design-token rename, the theme switcher, and a real brand accent and chart palette derived from the logo |
| `v0.8.0` | Budgets and Import CSV in frames, and focus that follows the page: the Budgets page and its dashboard widget, and the Import CSV page, run in sandboxed frames; Import CSV sends its file to the API in pieces (a staged upload, `upload/begin`, `chunk`, `finish` and `abort`) while the person maps the columns, so a frame can import a file of up to 8 MB; Tab and Shift+Tab hand focus across plugin frames at once, buttons, switches and checkboxes keep focus while their request runs (a `busy` prop and `guardBusy` in `@wickermoney/ui-kit`, additive), Escape in the phone navigation drawer returns focus to the Menu button, and the plugin frame's start-up downloads about 90 kB less; the ui-kit also publishes `--wm-toast-height` (experimental); no migration and no SDK change |
| `v0.7.0` | Daily use, load limits and the next plugins in frames: every action on Transactions, Recurring, Accounts, Categories and Settings says what it did in a notification toast (no Undo, nothing closes itself), the Transactions recurring column is a Link button with an inline picker, Upcoming, Forecast (the first page in a frame) and Debt payoff run in sandboxed frames (dialogs and forms included, so only Budgets and Import CSV remain in the app's own page), plugin frames start when they scroll into view, Debt payoff can leave a debt out of the plan, give one debt an extra amount, defer a loan, apply a promotional rate and compound per debt (migrations 034 and 035), a per-user API rate limit that is on by default, a limit on concurrent CSV imports, `pnpm dev` serving frames through the API, the `@wickermoney/ui-kit` toast (experimental) and two additive protocol messages in `plugin-sdk/isolated`, and the first end-to-end smoke specs |
| `v0.6.1` | A patch on `v0.6.0`: an owner confirms in Settings before switching on a third-party plugin (the dialog names its origin and granted tables and repeats the known gaps), the Transactions table and its row actions fit narrower windows, the `Origin-Agent-Cluster` console warning and the DevTools "blocks the use of `eval`" issue for the plugin frame are gone, migration 033 gives the account lines policy the per-statement user lookup, and the frame egress spike is recorded (no control closes the gaps in Chromium 141) |
| `v0.6.0` | UI plugin isolation and owner tooling: a sandboxed frame for plugin UI (Insights and Spending Trends now run in one), plugin-scoped tokens with default-deny routes, an integrity pin and an operator manifest directory for third-party plugins (experimental, no install flow), a hostile-plugin suite in CI, a password-confirmed data export, a Settings danger zone (erase my data, erase this instance), owners changing roles from People, the debt payoff plugin, configurable pool and statement limits with a 100,000-row import cap and paged analyze, merchant and amount sort indexes, lazy core pages and compressed responses, an accessibility sweep, and the API integration suite in CI |
| `v0.5.0` | Plugin platform hardening and account allowances: `plugin-sdk/server` (the host-to-plugin contract in one place), SDK stability tiers and shared `addDays` / `addMonths`, one shared read for dashboard widgets, one data load for recurring matches, `BOOTSTRAP_OWNER_EMAIL`, account allowances on Budgets (a monthly amount against one checking account, with rollover), an honest account of the plugin trust boundary, add and edit forms in the shared dialog, and a lint on `sql.raw` |
| `v0.4.2` | Phone layouts and UI cleanup: a navigation drawer, card layouts for Transactions, Accounts, Recurring and Categories, collapsible Categories and Rules, icon row actions, charts and budget tiles that fit narrow screens. Also the `:edge` image from `main` |
| `v0.4.1` | Two starter categories: Memberships (Subscriptions, everyone's base set) and Domains / web hosting (Technology, with the tech setup question) |
| `v0.4.0` | The plugin manager: owners turn plugins on and off from Settings, applied live, with data kept. Owner and member roles (only the first account is an owner). Matching from the Transactions page and dismissing a suggestion, plus seed data that shows matching. Form errors shown on the field they are about, with structured `issues` from the API |
| `v0.3.0` | Recurring items, the fast follow: paid / landed matching (suggested matches to confirm, per-occurrence skip, move and amount, late occurrences carried forward on matched items), so "Until payday" and the forecast stop counting what already arrived. Also budget windows (one amount for one category across a date range, such as holiday gifts from October 1 to December 25) and a shared exact-money module in `plugin-sdk` (`/money`) |
| `v0.2.1` | Recurring items, Phase B: a Forecast page (bundled plugin) showing each account's projected daily balance from its recurring items over 30/60/90 days, 6 months or to year end. It has a step chart with zero and buffer lines, a first-breach banner, stat tiles, and what moves the line. Also a time zone setting, with the browser's zone taken at sign-up |
| `v0.2.0` | Recurring items, Phase A: a Recurring page for income, bills, debt payments and transfers (items plus per-account legs), the "Until payday" dashboard widget with per-account shortfall warnings and a choice of which accounts count toward safe to spend, buffers editable on the Accounts page, the `plugin-sdk` recurrence module, and transfer `externalId` for duplicate-safe imports |

## Now

After `v0.8.0`:

- Close what the `:edge` soak and the real-device pass turn up. Firefox, Safari,
  a screen reader, a real phone and arm64 have not been checked for the frame
  work or the toasts, nor for the Import CSV and Budgets frames, the staged
  upload, or the focus hand-off and busy-control changes.
- Close the known gaps in the plugin frame, which the frame's content security
  policy does not cover in Chromium. The spike found no header, `allow` value or
  CSP directive that closes prerender or WebRTC in Chromium 141 (see
  `SECURITY.md`), so they stay documented. What is left is to re-test when a
  browser ships a control (the CSP `webrtc` directive is only a draft), and to
  stop the frame navigating itself to the app's origin once the server knows the
  address the browser used.

## Next

- Deep amount-sorted pages in the ledger and merchant search, which the new
  sort indexes do not speed up (about 65 ms and 130 to 165 ms on the largest
  synthetic ledger measured).
- End-to-end tests of the app's user flows in a browser, beyond the ten smoke
  specs in `e2e/`. They are not part of CI and the stack has not yet run under
  Docker, so the first real run may need fixing. Every soak check for a release
  is still manual.
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
  boundary the project does not have, so it stays first-party only.
- Caching layers beyond the per-user response cache, and an authentication
  lookup cache. Unmeasured, and the performance sweep reduced the need; revisit
  with numbers.
- Hosted-readiness: concurrent index builds, `NOT VALID` foreign keys with a
  later validate, batched backfills, asynchronous import jobs, a shared store for
  staged CSV uploads (they live in one API process's memory) and a per-tenant
  plugin registry cache. Nothing here helps a self-hoster, and a hosted tier is
  undecided.
- A way for a plugin to raise a toast (`ctx.notify`, ADR 0005 reserves the
  message). The Budgets and Import CSV ports shipped without it, since neither
  needed it, and the question is open for Debt payoff, whose messages stay inline
  on its page. Plugins keep inline status until it exists.
- Freezing the plugin API (`SDK_MAJOR_VERSION`) ahead of 1.0. The plugin SDK's
  entry points now carry stability tiers (see its README); the freeze applies
  to the stable ones.

## Ideas

Smaller things noticed during `v0.8.0`. These are not plans.

- Leaving the Import CSV page in the middle of an upload does not give the
  staged upload back. The frame cannot send `upload/abort` once the host has
  removed it, so the API holds the upload for 15 minutes, and doing it twice
  blocks a new upload (`begin`) until one expires.
- Four Import CSV controls still use `disabled` while a request runs, which
  drops keyboard focus to the page: "Check for duplicates", "Show more" and
  "Import" in the review step, and "Undo" in the history.
- A form-level error in the Budgets window and allowance forms is outside the
  form's focus target, so a refusal that no field owns cannot take focus (field
  errors do).
- Budgets loads its category and account lists when the page opens and does not
  reload them after a change, so one added elsewhere shows after a reload.
- Six README screenshot pairs are out of date: recurring, dashboard, budgets,
  plugins, insights and forecast.
- A closer look at an import of 25 MB or more under the new rate and concurrency
  limits.
