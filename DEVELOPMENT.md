# Developing Wicker Money

Everything you need to work on the code: the workspace layout, a local
database, tests, how the features work under the hood, writing a plugin, and
cutting a release. To run Wicker Money rather than change it, start with the
[README](README.md) and [wickermoney.dev](https://wickermoney.dev).

Before a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md) (Conventional
Commits, DCO sign-off, what a PR needs). The docs site has a gentler version of
some of this under
[Contributing](https://wickermoney.dev/docs/contributing/dev-environment).

## Contents

- [Layout](#layout)
- [Getting started](#getting-started)
- [Database](#database)
- [How the features work](#how-the-features-work)
- [Writing a plugin](#writing-a-plugin)
- [Releasing](#releasing)
- [Screenshots](#screenshots)
- [Milestone notes](#milestone-notes)

## Layout

| Path | Purpose |
|---|---|
| `apps/api` | Fastify backend and plugin host |
| `apps/web` | React frontend, Module Federation host |
| `packages/plugin-sdk` | The single contract both sides implement |
| `packages/ui-kit` | Shared components plugins import |
| `plugins/*` | Bundled and optional plugins |

## Getting started

Requires Node 22.22.2+ (or 24.15+) and pnpm 10 (`corepack enable pnpm`).

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
| `pnpm test:integration` | API integration tests against a real PostgreSQL (see [Running tests against the same server](#running-tests-against-the-same-server)) |

### Seed data

`pnpm --filter @wickermoney/api seed` fills the database `.env` points at with
four fixed personas, so you can click through every page without typing data
in. It goes through the same services as real requests, so row-level security
and validation apply. `seed:reset` deletes the personas first, then seeds again.

| Login | Password | What it has |
|---|---|---|
| `hero@seed.wickermoney.test` | `SeedHero!2026` | About 14 months of history, every account type and transaction shape, budgets |
| `household@seed.wickermoney.test` | `SeedHousehold!2026` | Two incomes, a split paycheck, recurring items with matched, late, skipped, suggested and dismissed occurrences |
| `second@seed.wickermoney.test` | `SeedSecond!2026` | A small second household, for checking tenant isolation |
| `fresh@seed.wickermoney.test` | `SeedFresh!2026` | Never onboarded: sign in as this one to see the setup wizard |

Sample CSVs for the importer are in `apps/api/src/db/seed/sample-csv/`.

## Database

The API connects as **`wickermoney_app`**, a least-privilege role that is not a
superuser and owns nothing. This is load-bearing rather than hygiene: a
superuser bypasses row-level security unconditionally, so connecting as one
would make every policy decorative and any test of them a false pass.

Migrations connect as the owner via `DATABASE_OWNER_URL`, since creating
schemas, policies and functions needs privilege the app role deliberately lacks.

Both URLs address the **same** database. Only the connecting role differs —
`DATABASE_OWNER_URL` is not a "migrate from" source, and no data is ever read
from a previous application.

Three operations happen before a user context exists — registration, login
lookup, refresh lookup. Each is a narrow `SECURITY DEFINER` function
(migration 006) rather than a general escape hatch, so the complete set of
things possible without authentication is three functions in one reviewable
file.

Those functions run with the privileges of the role that owns them, which is
the role that ran the migrations. `core.users` and `core.sessions` therefore
have `ENABLE ROW LEVEL SECURITY` but **not** `FORCE` (migration 007): FORCE
removes the owner's exemption, which is precisely the exemption the pre-auth
functions depend on. With FORCE on those two tables, registration fails with
*"new row violates row-level security policy"* and login silently finds no
user. The six ledger tables keep FORCE — no `SECURITY DEFINER` function
touches them.

That makes one thing load-bearing: **the API's role must not own the tables,
and must not be a superuser or hold BYPASSRLS.** Any of the three makes the
policies inert without anything appearing to break. The API checks all three at
boot and refuses to start otherwise.

```bash
docker compose -f docker/docker-compose.dev.yml up -d
cp .env.example .env
# set AUTH_SECRET:  openssl rand -base64 48
pnpm install
pnpm build
pnpm --filter @wickermoney/api migrate
pnpm dev
```

`migrate` does two things. It applies the schema as the owner, then grants the
application role LOGIN using `APP_DB_PASSWORD`. Migration 005 creates that role
`NOLOGIN` with no password on purpose — a migration file is the wrong place for
a secret — so without this second step the API cannot connect and Postgres
reports `role "wickermoney_app" is not permitted to log in`. The step is idempotent
and safe to repeat on every deploy.

`APP_DB_PASSWORD` must match the password in `DATABASE_URL`.

`migrate` also installs the **tenant-context signing key**, derived from
`AUTH_SECRET`, into `core.tenant_context_key`. The API refuses to start if the
database key is missing or does not match the running secret, so run `migrate`
again after rotating `AUTH_SECRET`. `pnpm --filter @wickermoney/api migrate reapply`
re-runs every migration's idempotent `up` to repair a database that has drifted.

### Security notes

Row-level security trusts `core.current_user_id()`, which returns a user id only
when the transaction also carries an HMAC signature of that id made with a key
the application and plugin roles cannot read. SQL that runs in a
transaction, including a plugin's, therefore cannot switch tenant by
overwriting `app.user_id`, with or without `RESET ROLE`. It is not a sandbox:
a plugin that can `RESET ROLE` regains the application role's table privileges
for its own tenant, so untrusted third-party plugins need out-of-process
isolation before they are installed.

The same applies to plugin UI code, which has no isolation at all: it runs in
the host's origin and can call any API route as the signed-in user. See
[Plugin trust model](#plugin-trust-model).

### Running tests against the same server

Unit tests (`pnpm test`) need no database. Integration tests are the API files
named `*.integration.test.ts`; run them with `pnpm test:integration`.

Integration tests need a real PostgreSQL instance — row-level security, check
constraints and exact numerics do not exist in a fake, so a passing test against
one would imply coverage that isn't there.

Use a **separate database**, and note that the suite creates and drops data
freely — never point it at a database you care about.

```sql
CREATE DATABASE wickermoney_test OWNER wickermoney;
```

```env
TEST_ADMIN_DATABASE_URL=postgresql://wickermoney:<owner-password>@<host>:5432/wickermoney_test
TEST_DATABASE_URL=postgresql://wickermoney_app_test:<any-password>@<host>:5432/wickermoney_test
```

The suite uses its own role, `wickermoney_app_test`, created automatically. That
separation is deliberate: PostgreSQL roles are **cluster-wide**, so if tests
reused `wickermoney_app` they would reset the password your `.env` depends on and
break development with no obvious cause.

**The owner in `TEST_ADMIN_DATABASE_URL` must not be a superuser, and the
harness refuses to run if it is.** A superuser-owned database makes the
`SECURITY DEFINER` functions bypass RLS, so the isolation tests pass without
proving anything and auth breaks on every real deployment. This is not
hypothetical — it is how a registration failure reached a running install with
the entire auth suite green.

## How the features work

The [README](README.md#features) has a short version of each feature for
people using the app. These are the full notes, including why each one works
the way it does. Read the relevant one before changing that area.

### First-run setup

A new account has no categories. On first entry the app opens a six-step wizard
that asks which circumstances apply — own a home, have pets, school-age
children, self-employed, and so on — and creates the matching branches of the
starter catalog. Everyone gets the same ~70-entry base set; the questions only
add to it.

The questions live on the server (`apps/api/src/categories/catalog.ts`), not in
the web app. A checkbox the catalog does not know about would tick and create
nothing, so the list is shipped from `GET /api/v1/onboarding` and the tests
assert the two cover each other in both directions: no catalog entry is
unreachable, and no question adds nothing.

**Re-running it.** Categories → *Run setup again* reopens the wizard with the
previous answers ticked; finishing adds only what is missing. *Reset setup*
clears the flag so the wizard reappears on next load. Ticking *also delete the
starter categories* first makes the reset destructive, which is what you want
when testing the wizard itself:

- only slugs the catalog defines are eligible, so anything you created by hand
  stays;
- anything a transaction, split or rule points at is kept and named back to you,
  along with any parent that pins;
- everything else goes, and the account is back to a genuine first run.

### Managing categories

Rename, re-parent, disable or delete from the Categories page.

**The slug is never editable.** It is the join key the starter catalog and a
future legacy import match on, so renaming `groceries` would turn the next
starter run into a duplicate-creating machine. The *name* is what you read, and
that is editable.

**Disable** hides a category from every picker and keeps every transaction
already filed under it — disabling is about what gets offered next, never about
rewriting what already happened. Disabling a parent takes its children with it.
A transaction already filed under a disabled category still shows that category
in its own row, so the row cannot silently look uncategorized.

**Delete** works only on a category nothing points at. Anything else is refused
with a count of what is holding it. The referencing tables are discovered from
`pg_constraint` rather than hardcoded, so a plugin's own foreign key — the
budgets plugin has one — is counted without core knowing that plugin exists.

Categories are two levels deep, enforced on create and on move. A third level
would be a category the grouped pickers cannot render, so they would drop it
silently.

### Transfers

Moving money between your own accounts is neither earned nor spent, and counting
it as either is the biggest single way a spending chart overstates. Record one
from Transactions → **Transfer**.

**A transfer is two rows**, written together and linked by a `transfer_id`. The
balance query sums transactions per account, so the single row the schema used
to allow took money out of one account and put it nowhere: every balance
downstream was quietly short, and the missing money appeared on the spending
chart instead. Deleting either leg deletes both, because a half-transfer is that
same bug by another route. Direction comes from the two accounts, never from the
sign.

Migration 012 backfills existing one-sided transfers — pairing any that already
had a mirror image, and writing the missing leg for the rest.

An importer can pass an optional `externalId` to
`POST /api/v1/transactions/transfer`. It is stored on both legs and is unique
per account, like a single transaction's, so sending the same transfer twice
answers `409 duplicate_external_id` instead of writing a second copy — and
neither leg is written if either account already has that id.

### What a category counts as

Every category has a **kind**: spending, income, or transfer.

- **transfer** is excluded from both series. This is the home for a credit-card
  payment or a savings contribution typed in by hand, which is money moving even
  when it was never recorded as a proper pair.
- **income** is what stops a refund being misread. A £25 supermarket return is a
  positive amount against Groceries; sign alone calls that income, where kind
  keeps it an expense and reduces what Groceries cost that month.

Classification is kind first, sign as a fallback, so an uncategorized import
still charts sensibly before anyone has triaged it. The rule lives in one place
(`apps/api/src/transactions/classify.ts`) because four consumers need it and the
previous version had it written out at each call site, where they disagreed.

Setting a kind on a parent sets it on the children — a "Transfers" parent whose
children were still expenses would exclude nothing.

### The dashboard time range

One control for the whole dashboard, not one per widget: two charts side by side
showing different periods while looking comparable is the specific way a
dashboard misleads.

The range is resolved by the host and handed to each widget as a `range` prop —
there is no event bus, so widgets cannot observe or affect each other. A widget
with nothing to scope ignores it. `DashboardRange` carries both `months` (what
the aggregate endpoints already take) and resolved `from`/`to` dates, so
"year to date" is expressible without breaking anything that counts in months.

Ranges end at the end of the current month rather than at today, because a
trailing part-month bar shrinks while you look at it and invites comparing half
a month against whole ones.

### Budgets

A budget is one row per category **per calendar month**, not a template that
gets mutated forever. That single choice is what makes budget-vs-actual history
survive a period boundary, and it retires two defects from the previous version
outright.

Nothing about a month is stored except the plan:

- **Spend is derived on every read** from the ledger, including splits, so the
  budgets page and the transactions page cannot disagree.
- **Carry-forward is replayed from history**, so a receipt imported late against
  an old month corrects every month after it automatically.

**Rolls over** is per line, not a global setting. On, the line is a sinking
fund: what is left at month end is added to the next month, and overspending is
carried too — a fund you overdrew has less in it. Off, it is a monthly
allowance that starts fresh. Car maintenance wants the first, groceries the
second, which is why one switch for the whole budget would be wrong for half of
anyone's categories.

**A month you have not planned yet shows last month's lines as a draft.**
Nothing is written until you edit one or press *Start &lt;month&gt; from these*, so
looking ahead at November in October stays a read.

The bar on each line marks today. A line at 80% is fine on the 28th and a
problem on the 10th, and the *Budget breakdown* dashboard widget ranks by that
rather than by amount: lines that are over or ahead of pace first, then the rest
by how much of their budget is used.

**A window** is the exception to one month per line: one amount for one category
across a date range, spent down to zero, such as holiday gifts from October 1
through December 25. Add one under **Windows** on the Budgets page. Each month
it touches shows what was left coming in, what that month spent and what is left
now, and the line shows "spent so far of funded" for the whole window. The full
amount counts as planned only in the first month, so totals never fund it twice.
Lumpy spending is the point of a window, so it is never marked "at risk"; only
an overdrawn window is "over". Spending in that category outside the window's
dates still shows as unbudgeted, and a category cannot have a window and a
monthly line on the same day (migration 023 enforces it).

### Recurring items and "Until payday"

**Recurring** (in the sidebar, after Transactions) holds the income, bills, debt
payments and transfers you expect. Each item is a schedule plus one **leg** per
account it touches, with a signed amount, the same way a transfer is two
transaction rows: a bill is one negative leg, a split paycheck is a positive leg
per account, and a transfer or debt payment is two legs that net to zero. The
form asks for positive amounts; the kind supplies the sign.

The schedule's start date is an anchor, never shown as "due". The next due date
is always derived, and "today" is your calendar day in your user's timezone
(`users.timezone`), worked out on the server — so the page, the widget, the
forecast and any plugin agree, and none of them trust the browser clock. A new
account takes the browser's zone when it registers; change it under **Settings
→ Time zone**. An account created before `v0.2.1` starts on `UTC`, where "today"
turns over in the evening west of UTC (8pm in New York in summer), and Settings
offers the browser's zone in one click. Monthly, quarterly and annual items on the 29th–31st clamp to the last
day of shorter months; semimonthly items store their two days (1st and 15th by
default). Editing an item rewrites the whole series; to change something from
now on, end the item and add a new one. The monthly tiles use exact factors
(biweekly is 26/12 a month, not 2.17).

The **Until payday** widget (bundled plugin `plugins/upcoming`) answers "will I
make it to payday?" for the window from tomorrow through the next expected
income into any account, or 14 days if none is expected:

- each checking account's lowest point in that window (and any savings account
  marked *Safe to spend*), counting a day's outflows before its inflows, and its
  room above that account's **buffer**;
- a shortfall banner for any account that dips below its buffer. Accounts are
  never pooled: one account's surplus does not cover another's shortfall;
- **safe to spend**: the sum of positive room across the accounts you mark
  *Safe to spend* on the Accounts page (checking accounts by default; savings can
  opt in). An account that is not counted is still projected and still warned
  about.

Set each account's buffer and *Safe to spend* on the Accounts page.

**Did it land?** Once a paycheck or bill has posted, match the transaction to
the occurrence it paid, and the widget and the forecast stop counting it as still
to come. The Recurring page suggests likely matches under **Did these land?**
(same account and sign, within 5 days and 25% of the amount); nothing is matched
without a click. Each item's **History** panel lists its recent and coming
occurrences with what paid each one, and a single occurrence can be skipped,
moved or given a different amount per account without touching the rest of the
series. An item you have matched at least once is *tracked*: an occurrence that
has not arrived is flagged late for up to a week and still counted, on the next
projected day. Items you never match behave as they did before.

You can also match from the **Transactions** page: its Recurring column shows
the occurrence a transaction paid (with *Unmatch*), a suggestion to confirm, or
*Other* to pick an occurrence yourself. *Not this* dismisses a suggestion on
either page, so that pairing is not offered again, and *Undo* brings it back.

### Forecast

**Forecast** (bundled plugin `plugins/forecast`, in the sidebar after Recurring)
answers "where is this account heading?" Pick an account and a horizon: 30, 60
or 90 days, 6 months, or the end of the year. The page projects that account's
balance day by day from its recurring items, starting from today's actual
balance, using the same rules as "Until payday":

- it is a step chart, because a balance jumps when money moves and is flat in
  between. On a day with both a bill and a paycheck, the bill clears first, so
  rent due on payday shows as a dip;
- zero is a solid line and the account's buffer a dashed one. A banner names
  the first day the balance drops below either, and the tiles count the days
  spent below each;
- transfers move both accounts and are listed in a neutral colour with their
  direction ("to Savings"). A credit card or loan gets the chart without
  overdraft or buffer warnings, because a negative balance there is just what
  is owed.

It projects the **schedule**, not your spending: everyday purchases that are not
recurring items are not in the line. The numbers come from
`GET /api/v1/core/recurring-items/forecast`, computed on the server against your
today.

## Writing a plugin

A plugin is a Module Federation remote plus a manifest. Two rules are not
obvious from the manifest schema, and both fail at runtime rather than at build
time, so they are worth stating plainly.

**The remote entry must be an ES module.** The host registers every remote with
`type: 'module'` and loads it with a dynamic `import()`. A remote built as a
classic script fails at widget mount with *"Cannot use import statement outside
a module"* — one opaque error per widget, long after the manifest validated.

**CSS must be injected, not imported for its side effect.** A remote has no HTML
document, so the stylesheet Vite emits is never requested. A side-effect
`import './viz.css'` therefore does nothing at all: the widget mounts, fetches
and renders, and simply looks broken with every custom property unset. Import
the CSS as text and hand it to the SDK instead:

```ts
import { adoptPluginStyles } from '@wickermoney/plugin-sdk/runtime'
import css from './viz.css?inline'

adoptPluginStyles('your.plugin.id', css)
```

Import from `@wickermoney/plugin-sdk/runtime`, not the package root — the root
re-exports the Zod manifest schemas, which are a server-side concern and add
~85 kB to a plugin bundle that has no use for them.

Scoping remains the plugin's job. `adoptPluginStyles` injects into the host
document; it is not a style sandbox.

**Paths are relative to the API root.** The injected client adds `/api/v1`, and
so does the host when it mounts a plugin's endpoints. A plugin that writes the
prefix itself produces `/api/v1/api/v1/p/...` and a 404 that reads like a
missing route; the client now refuses such a path outright.

### Server endpoints

A plugin that owns storage needs a server half. It lives in the plugin package
(`src/server/`), is compiled by tsc, and the API imports it as a workspace
dependency — one package, two build outputs, so uninstalling a plugin never
means editing core.

**Bundled plugins only.** That code ships inside the image and is reviewed with
the rest of the application. Running a third-party plugin's server code needs a
sandbox this does not have, so `contributes.endpoints` is refused for anything
not in `BUNDLED_PLUGINS`.

What a bundled plugin still does not get:

- The application's database handle. It receives a `runAsPlugin` that has
  already switched to the plugin's own PostgreSQL role, so a query outside its
  manifest's `requiredTables` is refused by the database.
- A way to act as another user — the id comes from the verified token.
- Its own idea of core behaviour. Categorization, for instance, is injected from
  the core rule engine rather than reimplemented.

### Plugin trust model

UI plugins (widgets and pages loaded over Module Federation) run **fully
trusted, in the host's origin**. Read this before writing or reviewing anything
that talks about plugin "permissions", "scoping" or "sandboxing".

| Layer | What it does | Boundary against plugin code? |
| --- | --- | --- |
| Per-plugin PostgreSQL role (`plugin-roles.ts`) | Refuses queries outside the manifest's `requiredTables` | For **server-side** plugin code (bundled plugins' `runAsPlugin`) that behaves: a guardrail, not a sandbox, because crafted SQL can leave the role |
| `assertSafePluginSql` (the plugin query runner) | Refuses statement text that changes the role or session settings | **No.** It reads text, and a `DO` block with dynamic `EXECUTE` gets past it. It exists to catch mistakes |
| Row-level security | Keeps every query inside the signed-in user's rows | Yes, for tenants, including after the SQL leaves the plugin role (the tenant context is signed) |
| `x-wickermoney-plugin` header + `requireTableGrant` | Holds a request that names a plugin to that plugin's manifest | **No.** A request with no header is the host application, so a UI plugin can omit it |
| Scoped `ctx.api` client in `apps/web/src/plugins/context.ts` | Fails fast on an ungranted path | **No.** Developer ergonomics; plugin code can call `fetch` |
| `PLUGIN_REMOTE_ORIGINS` and the CSP | Limit where plugin code may be loaded from | No. They choose whose code is trusted, not what it may do |

Consequences for contributors:

- Do not describe `requiredTables` as protecting data from a UI plugin. It
  protects data from a plugin's server code.
- Do not describe the plugin role or the SQL screen as a sandbox for server
  code. They stop mistakes; row-level security is what holds against hostile
  SQL. Do not add patterns to `FORBIDDEN_SQL` to "close" the dynamic-SQL gap:
  a connection the plugin cannot leave is the real fix, and it belongs with
  plugin isolation.
- Do not rely on the plugin header for access control. A route that must not
  be reachable by UI plugins needs a different mechanism, which does not exist
  yet.
- Third-party plugin install stays unsupported, and `PLUGIN_REMOTE_ORIGINS`
  stays empty by default, until UI plugins are isolated.

### When a plugin is turned off

An owner can turn any plugin off from Settings → Plugins. The host unmounts the
plugin's pages and widgets (a remote already loaded stays in memory but is no
longer rendered), its own routes answer `404 plugin_disabled`, and a core data
request carrying its `x-wickermoney-plugin` header gets `403 grant_denied`.
(A request that omits the header is not attributed to the plugin, so a
disabled plugin's already-loaded code is not stopped from calling core routes;
see [Plugin trust model](#plugin-trust-model).)
Its schema, rows and role are kept. Do not assume a plugin's code runs at
every page load, and do not delete data on unmount.

**Validation errors.** A bundled plugin's server can attach
`issues: { path, message }[]` to an error, the same shape as the API's
`validation_failed`, and the host passes it through. On the page, ui-kit's
`formErrorsFrom` and `useFormErrors` put each issue on its field and render
the rest with `FormError` beside the submit button.

### Request sharing in the scoped client

`ctx.api.get` does not always reach the network. Plugins are separate
federated bundles that cannot share module state, so the host's scoped client
(`apps/web/src/plugins/context.ts`, backed by `apps/web/src/api/responseCache.ts`)
holds a small in-memory memory of reads. It exists so that several widgets
asking for the same thing at once, such as the three dashboard widgets that
read `/core/transactions/monthly-summary?months=12`, cost one request.

The rules:

- **Per user, never shared between users.** Entries live in a bucket per user
  id, and the key inside it is the method plus the full URL, query string
  included. Concurrent identical `GET`s join one request; a resolved one is
  served again for `RESPONSE_CACHE_TTL_MS` (5 seconds). Each user keeps at
  most `RESPONSE_CACHE_MAX_ENTRIES` (50) entries, least recently used out first.
- **The plugin id is not in the key.** The server reads `x-wickermoney-plugin`
  only to grant or refuse (`403`), never to change the data, and the client-side
  guard applies the same grants before the cache is consulted. So two plugins
  that may both read a table share the answer. The request that actually goes
  out carries the id of whichever caller came first.
- **Writes drop the cache.** Any non-`GET` request through the client, from a
  plugin or from the host's own pages, empties the cache before it is sent and
  again when it settles (even if it fails). It is by user, not by endpoint, so
  a plugin never has to know which reads a write affects. A read that was in
  flight when the write happened still answers its own callers but is not
  stored. Sign-in, sign-out, a refused refresh and a refresh that returns a
  different user's token clear everything too.
- **Failures are never kept.** Callers already waiting on a failing request all
  get its error; the next call asks again.
- **You get your own copy.** Every caller receives a clone of the response, so
  mutating it cannot affect another widget. Aborting your `signal` stops only
  your wait, not the shared request.
- **To bypass it, pass `cache: 'no-store'` or `cache: 'reload'`** (standard
  `fetch` options, so the SDK types need nothing new):

  ```ts
  const fresh = await ctx.api.get<Summary>(path, { cache: 'no-store' })
  ```

  The call goes to the network, never joins a request in flight, and drops the
  remembered answer for that URL. Calls that pass other options, such as custom
  `headers`, skip the cache the same way. You rarely need this: after your own
  write the cache is already empty. Reach for it only when something outside
  this tab, such as another device or a server-side job, may have changed the
  data and a few-second-old answer would be a bug.

What this does not do: the API has no server-side cache, and the host's own
unscoped `api` client never reads from this memory, so the plugin registry and
its focus-triggered refetch are always live. A plugin that
is turned off can still be answered from memory for up to the TTL; the host
unmounts it, so this is not visible.

### Plugin roles

Each plugin gets a PostgreSQL role, named `<app role>_plugin_<slug>` and granted
exactly what its manifest asks for. Grants are recomputed from the manifests on
every `pnpm migrate`, revoking first, so removing a table from `requiredTables`
actually removes the grant.

Roles are namespaced under `APP_DB_ROLE` for the same reason the app role is:
PostgreSQL roles are cluster-wide, so two Wicker Money databases on one server would
otherwise fight over them. Set `APP_DB_ROLE` the same way for `pnpm migrate` and
for the API.

## Releasing

Push a version tag; `.github/workflows/release.yml` does the rest.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

It re-runs lint, typecheck, build and the unit tests on the tagged commit, then:

| Output | Where |
|---|---|
| `@wickermoney/plugin-sdk` and `@wickermoney/ui-kit` at the tag's version, with npm provenance. These are the only published packages; the bundled plugins, `apps/api` and `apps/web` are private. | npm |
| Multi-arch image (amd64 + arm64), `:<version>` and `:latest` | `ghcr.io/wickermoney/wicker-money` |
| A release with generated notes from the commit subjects since the previous tag | GitHub releases |

The same version, and the exact commit, also go into the image as build-args
(`VERSION`, `GIT_SHA`). `apps/api` and `apps/web` stay private and are never
published above, but the image build stamps their own `package.json` with it
too (`docker/stamp-version.mjs`) -- so the API's `/healthz`/`/readyz` and the
web app's About page always agree with the tag, with nothing to remember to
update by hand.

A tag such as `v0.1.0-rc.1` is a prerelease: the packages go out under the npm
`next` tag, the image never takes `:latest`, and the release is marked as a
prerelease. Re-running the packages job after a partial failure is safe; a version
the registry already has is skipped.

The npm packages publish via [trusted publishing](https://docs.npmjs.com/trusted-publishers)
(OIDC) rather than a stored token: no `NPM_TOKEN` secret exists or is needed.
Each package has a trusted publisher configured on npmjs.com pointing at this
repository and `release.yml`, and the `packages` job's `id-token: write`
permission lets it exchange a short-lived credential for the actual publish.
The image push uses the built-in `GITHUB_TOKEN`. New ghcr packages are private
by default, so after the first image push set the `wicker-money` package to
public in the organization's package settings. Every job is guarded by a
repository check, so a tag pushed to a fork or mirror publishes nothing.

Pull requests also build the image (without pushing it), so a broken Dockerfile
fails before a tag does.

### The `:edge` image

Every merge to `main` runs `.github/workflows/edge-image.yml`, which publishes
`ghcr.io/wickermoney/wicker-money:edge` plus `:edge-<short sha>` (amd64 and
arm64). It runs `ci.yml` first as a reusable workflow, so a red `main` publishes
nothing. `:edge` is not a release: it never takes `:latest` or `:next`, publishes
no npm packages and creates no GitHub release, and the app reports its version as
`0.0.0-edge.<sha>`. Merging a migration moves `:edge` onto it immediately, so back
up the database before pulling `:edge`, and pin `:edge-<short sha>` to stay on one
build. To re-publish by hand, use **Actions → Edge image → Run workflow** on
`main`; any other branch is refused (use the preview image below for those).

### Trying a branch before it merges

`.github/workflows/preview-image.yml` builds an image from any branch on
demand: **Actions → Preview image → Run workflow**, choose the branch and the
architecture. It pushes `ghcr.io/wickermoney/wicker-money-preview:<branch>`
(lowercased, `/` becomes `-`) plus a `-<short sha>` tag. It publishes nothing
to npm, creates no release, and never touches the real `wicker-money` package.
The app reports its version as `0.0.0-preview.<sha>`, so a preview cannot be
mistaken for a release.

`docker/docker-compose.preview.yml` runs that image beside a real install, with
its own project name, database volume and port (8181). It can start empty or
from a `pg_dump` of the real database (the steps are in the file's header). To
throw a preview away, `down --volumes` removes the database with it, and
deleting the package version in the organization's package settings removes
the image. The preview package is private by default, so the Docker host
needs a `docker login ghcr.io` with a token that has `read:packages`.

### Pruning old images

Two workflows keep `ghcr.io/wickermoney` from growing without bound. Both are
dry runs until the repository variable `GHCR_CLEANUP_LIVE` is `true`, and both
need a `GHCR_CLEANUP_TOKEN` secret (a classic PAT with `delete:packages`, or a
GitHub App token with `packages: write`); `GITHUB_TOKEN` cannot use the tag
wildcards.

- `package-cleanup.yml` runs daily on `wicker-money`. It never deletes
  `:latest`, `:next`, `:edge` or a stable version tag. It deletes `:edge-<short sha>`
  tags older than 14 days (keeping the newest 10), prerelease tags such as
  `0.5.0-rc.1` older than 60 days, and untagged versions older than 7 days. The
  untagged rule also covers `wicker-money-preview`. Per-arch images that a kept
  manifest list points at are protected, so a multi-arch pull keeps working.
- `preview-cleanup.yml` deletes a branch's `wicker-money-preview` tags when its
  pull request is closed or the branch is deleted, and sweeps weekly for
  previews whose branch is gone or that are older than 30 days. Its tag
  sanitiser must match the one in `preview-image.yml`.

Every run writes a summary to the run page (the "GHCR cleanup" section at the
bottom): what was or would be deleted, with tags, age and the rule that picked it,
and which untagged images were kept because a manifest list points at them.
`package-cleanup.yml` also attaches the report and the before/after package
snapshots as the `ghcr-cleanup-report` artifact (30 days). The step log is mostly
Docker noise; the lines that matter are snok's `dry-run: Would have deleted`
lines, whose ids are the summary's version ids.

To check a change to either file, run it from **Actions → Run workflow** with
`GHCR_CLEANUP_LIVE` unset and read the summary before going live.

## Screenshots

The images in the README live in [`docs/screenshots/`](docs/screenshots), one
light and one dark per page, and the README shows the one that matches the
reader's GitHub theme. They are taken from the seed data at 1680×1000. To
retake them after a UI change, run the seed and `pnpm dev`, then:

```bash
# once, in a scratch folder outside the repo
npm i playwright@1 && npx playwright install chromium
# then, from that folder
node <repo>/docs/screenshots/capture.mjs
pngquant --ext .png --force --quality 80-95 <repo>/docs/screenshots/*.png
```

Playwright is not a workspace dependency on purpose: the browser download is
not worth adding to every install for something done a few times a year.

The script's header lists which persona and page each image comes from.

## Milestone notes

[CHANGELOG.md](CHANGELOG.md) lists what each release added. These notes from
the first milestones explain design decisions that are still load-bearing.

**M3 — import, and categorization.** `plugins/import-csv` imports bank and card
statements: a column mapping saved per source, an explicit date format with a
live parse preview, duplicate detection that prefers the source's own
transaction id and surfaces guesses for review, and batch undo. It owns a
`plugin_import_csv` schema and runs under its own PostgreSQL role.

That role is the enforceable half of `requiredTables`. Grants are derived from
each manifest on every migrate, and every plugin request runs inside
`SET LOCAL ROLE` — so a query outside the manifest is refused by PostgreSQL
rather than by the application choosing not to issue it.

Alongside it, a **Categories** page for categories and rules (with the Q13
preview before a rule touches anything), and triage on the Transactions page:
an uncategorized filter, inline assignment, and bulk assign. Bulk assignment
records `manual`, so a later rule sweep leaves it alone.

Migration 009 closed a cross-user hole found while testing the importer:
foreign keys bypass row-level security, so a transaction could be attached to
another user's account. Composite `(user_id, …)` keys make that impossible for
every writer.

**M2 — the shell and the first plugin.** `apps/web` is a real host: sign-in,
nav, and a dashboard that contributes no widgets of its own. Everything on it
arrives from `plugins/insights`, a bundled plugin loaded over Module Federation
with `react` as a singleton. Each widget sits behind its own error boundary, so
a plugin that throws costs one card rather than the page. Disabling a plugin in
`core.plugins` makes its contributions disappear on the next load, with no code
change anywhere.

Plugins reach core data through a scoped client that attaches their id to every
request; the server checks that id against the manifest's `requiredTables` and
answers `grant_denied` for anything the plugin never asked for. That check is
feedback for honest plugins, not a security boundary: plugin code shares the
host's realm and origin and can omit the header (a request with none is treated
as the host application). The matching client-side guard is developer
ergonomics for the same reason. The enforceable second layer, a
database role per plugin, arrived with M3 above (`plugin-roles.ts`'s
`pluginRoleName`/`asPlugin`, used by every bundled plugin, not just
import-csv) — this paragraph originally said that arrives at M4; it shipped
earlier than planned.

**M1 — auth and ledger.** Users, sessions, accounts, categories, category
rules, transactions and splits, all under row-level security. Account balances
are derived from the ledger, never stored. Money is `numeric(19,4)` in Postgres
and `string` in TypeScript — never `number`.

204 tests, including an isolation suite that proves one user cannot read, fetch
or modify another's rows, and a suite that proves a plugin cannot reach a table
its manifest never asked for.
