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
| `e2e` | Browser tests against the built image (Playwright) |

## Getting started

Requires Node 22.22.2+ (or 24.15+) and pnpm 10 (`corepack enable pnpm`).

```bash
pnpm install
pnpm build
pnpm test
```

| Command | What it does |
|---|---|
| `pnpm dev` | Runs api and web in watch mode. Plugin frames need a built web app first: see [Isolated plugin frames](#isolated-plugin-frames) |
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

Owners changing roles is the one other place the application reaches past
row-level security (migration 029). An owner sees only their own `core.users`
row, so `core.list_users_for_owner()` and `core.set_user_role()` are
`SECURITY DEFINER` too. They re-check, from the signed tenant context, that the
caller is an owner, return only id, email, role and creation time, and take
the advisory lock that registration uses for "is there an owner yet?" so the
last-owner count is decided one change at a time. They refuse to run above
`READ COMMITTED`, where that count could be stale. The routes are
`GET /api/v1/users` and `PATCH /api/v1/users/:id/role`; the API's
`requireOwner` runs first, and the role is read from the database on every
request, never carried in a token.

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

### Pool, timeouts and import limits

Six settings bound how much database work one API process does. Defaults match
the behaviour before they existed, except the import row cap (below).

| Setting | Default | What it does |
|---|---|---|
| `DB_POOL_MAX` | `10` | Connections the API may hold open (2 to 200). Every request holds one for the length of its transaction. PostgreSQL's `max_connections` must cover it for each API process. |
| `DB_STATEMENT_TIMEOUT` | `30000` | Longest one SQL statement may run, in **milliseconds** (1000 to 3600000, so `30` is rejected, not read as seconds). |
| `DB_LONG_STATEMENT_TIMEOUT` | `300000` | The same limit for CSV import and the data export only, milliseconds, not lower than the one above. Set per transaction by the host, so it ends with the transaction. A plugin route opts in with `longRunning: true` in `RegisterRoute`'s options. |
| `IMPORT_MAX_ROWS` | `100000` | Data rows one CSV import may contain, counting unreadable ones. The 8 MB file limit applies as well and is not configurable. |
| `IMPORT_MAX_CONCURRENT` | half of `DB_POOL_MAX` (at least 1) | CSV imports this process commits at once; others wait for a turn without holding a connection (1 to 1000, blank means the default). At or above `DB_POOL_MAX` it has no effect. Per process: each API instance has its own. |
| `IMPORT_QUEUE_WAIT_SECONDS` | `30` | Longest an import waits for its turn, in **seconds** (0 to 600), before it is refused with `503 import_busy` and a `Retry-After` header. `0` refuses at once when every slot is busy. |

**Why 100,000 rows.** An 8 MB file holds about 109k bank-style rows, 67k with a
memo column, and 374k rows of minimal text, so the size limit alone does not
bound the work. Measured on 2 vCPUs with a local PostgreSQL 16 and a pool of 10,
against the real API process:

| Rows | File | Analyze | Commit | API memory, analyze / commit | Event-loop stall |
|---|---|---|---|---|---|
| 25,000 | 1.7 MB | 0.3 s | 4.4 s | +51 / +21 MB | 0.23 s |
| 50,000 | 3.7 MB | 0.5 s | 7-9 s | +92 / +107 MB | 0.41 s |
| 100,000 | 7.4 MB | 1.0 s | 17 s | +190 / +110 MB | 0.7-0.8 s |
| 108,840 | 8.0 MB | 1.0 s | 15-18 s | +206 / +135 MB | 0.8-0.9 s |
| 373,585 | 8.0 MB | 2.1 s | 48 s | +194 / +317 MB | 1.1-1.3 s |

Commit time is linear (about 150 microseconds a row, mostly PostgreSQL), and it
is the time a pooled connection and the account's import lock are held. 100,000
rows keeps it near 15-18 seconds here, which leaves a slower host room under a
reverse proxy that cuts requests off at 60 seconds. On a small device, lower it.
These are one machine's numbers, not a benchmark: the shape (linear in rows) is
the useful part.

**Concurrent imports.** A commit holds one pooled connection for its whole
length, so before 0.7.0 ten simultaneous 50,000-row commits held all ten
connections of the default pool for about 40 seconds and nearly every other
request in that time failed waiting for one. Now at most `IMPORT_MAX_CONCURRENT`
commits run at once per process. A commit over the limit waits **before** it
parses the file or opens its transaction, so it holds no connection, and the
rest of the app keeps the other half of the pool. If a commit has not had its
turn after `IMPORT_QUEUE_WAIT_SECONDS` it is refused with `503`, code
`import_busy`, `Retry-After` and a message saying nothing was imported; the page
shows that sentence beside the button, keeps the review, and sending it again
reuses the commit's idempotency key, so it imports once.

The limiter lives in the Import CSV plugin's server half (`ImportGate`), not in
the host: the host only reads the two settings, hands them over with
`IMPORT_MAX_ROWS`, and turns a plugin error's `retryAfterSeconds` into the
header. `analyze` is not limited: it holds a connection only for its one
read, and 10 simultaneous 50,000-row analyses took 4.6 seconds with no failed
request (they do stall the event loop while parsing, which a limit on
connections does not help).

Why wait instead of refuse at once: with 10 people committing 50,000 rows on a
pool of 10 (2 vCPUs, local PostgreSQL 16), refusing at once (`0`) turned 5 of
the 10 away and finished the other 5 in 21 seconds; waiting finished all 10, the
last after about 45 seconds. A wait is only useful if it is shorter than the
proxy's cut-off, hence 30 seconds (a wait plus a commit stays under nginx's
60 seconds); set `0` if you would rather see the refusal. Measured the same way,
back to back:

| Setting | Failed other requests | Wall time, all 10 commits | Each import |
|---|---|---|---|
| Before (no limit, `IMPORT_MAX_CONCURRENT=10`) | 319 of 402 (500, 5 s connection timeout) | 51 s | 49-51 s |
| Default (limit 5, wait 30 s) | 0 of 358 | 45 s | 21-45 s, last waits about 21 s |
| Limit 5, `IMPORT_QUEUE_WAIT_SECONDS=0` | 0 of 168 | 21 s | 5 done in 20-21 s, 5 refused in about 1.6 s |

(Probes were a readiness check and an authenticated list every 250 ms, so the
count is higher than the 8 of 106 the 0.6.0 run saw; the direction is the same.
Measured in a shared 2-CPU container, so absolute numbers are indicative; compare
the rows, which ran one after another.) One person importing alone sees no
difference: a 100,000-row commit took 15.2 s with the limit and 14.5 s without.
The limit is per process and the pool is not shared between processes, so two
API instances allow twice the imports; with several, set it from the pool and
`max_connections` per instance.

`analyze` answers with the counts for the whole file, its first 100 rows and a
page of up to 500 possible duplicates (`flaggedOffset` and `flaggedLimit` ask
for another page), instead of every row: 19 KB instead of 21 MB for an 8 MB
file. `commit` classifies the file itself, so rows never shown are handled the
same way.

### PgBouncer

Run the API through PgBouncer in **transaction** mode only if you need to
multiplex more API connections than PostgreSQL should hold. Nothing in the app
depends on a session: the tenant binding and role switch are
`set_config(..., true)` and `SET LOCAL ROLE`, which end with the transaction, and
the import lock is `pg_advisory_xact_lock`.

What was tested: PgBouncer 1.22.0, `pool_mode = transaction`,
`default_pool_size = 4` under the API's pool of 10 (so connections really are
shared), and the full integration suite run through it. It does not work as
installed, and it works with one change:

- The API sends `statement_timeout` and `idle_in_transaction_session_timeout` as
  connection startup parameters. PgBouncer refuses them (`unsupported startup
  parameter`) and the API cannot connect. Add
  `ignore_startup_parameters = statement_timeout,idle_in_transaction_session_timeout`
  to `pgbouncer.ini`.
- Those two limits then **no longer apply** through the pooler, whatever
  `DB_STATEMENT_TIMEOUT` says. Put them on the role instead, and reconnect
  PgBouncer's server connections (`RECONNECT`) so new ones pick them up:

  ```sql
  ALTER ROLE wickermoney_app SET statement_timeout = '30s';
  ALTER ROLE wickermoney_app SET idle_in_transaction_session_timeout = '60s';
  ```

  (`DB_LONG_STATEMENT_TIMEOUT` still applies, since it is set inside the
  transaction, and overrides the role's value for import and export.)
- With that, 1,011 of 1,014 integration tests passed. The three that did not
  check the pool's own default limit (`statementTimeout.integration.test.ts`),
  which is the ignored parameter above, not a data problem.

Not tested: session or statement pool modes (statement mode cannot work, as
transactions span statements), other PgBouncer versions, other poolers, running
migrations through a pooler (point `DATABASE_OWNER_URL` at PostgreSQL directly),
and any production load. Treat it as supported for the setup above and verify
the rest yourself.

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

### What CI runs

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`, and `edge-image.yml` (every merge to `main`) and `release.yml` (every
tag) call it as a reusable workflow before they build an image. A red job
therefore stops a pull request, `:edge` and a release alike. None of its test
jobs uses a secret, and none has a path filter or an `if:`, because a skipped
job counts as a pass for a required check.

| Status check name | What it runs | Needs |
|---|---|---|
| `Lint, typecheck, build, test` | `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (unit tests, no database) | nothing |
| `API integration (Postgres 16)` | `pnpm test:integration`: every `*.integration.test.ts` file in the API, against PostgreSQL 16 | `postgres:16-alpine` service container |
| `Hostile plugin suite` | `pnpm test:hostile` ([details](#hostile-plugin-suite)) | PostgreSQL 16 service container, Chromium |
| `Image build (linux/amd64)`, `Image build (linux/arm64)` | builds the image without pushing it (skipped on tag pushes, where `release.yml` builds it) | Docker |

Require the first three as status checks on `main` (repository settings,
Rules); a check that is not required only informs.

**How the integration job gets its database.** The service container's
bootstrap superuser (`postgres`) only creates an owner role, `wickermoney`
(`LOGIN CREATEROLE`, not a superuser), and the `wickermoney_test` database it
owns. The suite connects as that owner to migrate and provision, and makes the
application and plugin roles itself, exactly as in
[Running tests against the same server](#running-tests-against-the-same-server).
The passwords in the workflow belong to a container that lives as long as the
job, on a runner that is thrown away with it; they are not secrets. The job builds
nothing explicitly: the `test:integration` task depends on `^build`, so turbo
builds the packages the API imports.

**Reproducing it locally.** Use a throwaway container on port 5433, so it does
not collide with the development database from `docker-compose.dev.yml` on 5432.
Do not reuse that container's `wickermoney` user as the owner: it is the
image's bootstrap superuser, and the harness refuses a superuser owner.

```bash
docker run -d --name wm-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5433:5432 postgres:16-alpine
until docker exec wm-test-pg pg_isready -U postgres -q; do sleep 1; done
docker exec wm-test-pg psql -U postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE wickermoney LOGIN CREATEROLE PASSWORD 'ownerpw'" \
  -c "CREATE DATABASE wickermoney_test OWNER wickermoney"

export TEST_ADMIN_DATABASE_URL=postgresql://wickermoney:ownerpw@localhost:5433/wickermoney_test
export TEST_DATABASE_URL=postgresql://wickermoney_app_test:testpw@localhost:5433/wickermoney_test
pnpm test:integration

docker rm -f wm-test-pg
```

```powershell
docker run -d --name wm-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5433:5432 postgres:16-alpine
do { Start-Sleep 1; docker exec wm-test-pg pg_isready -U postgres -q } until ($LASTEXITCODE -eq 0)
docker exec wm-test-pg psql -U postgres -v ON_ERROR_STOP=1 `
  -c "CREATE ROLE wickermoney LOGIN CREATEROLE PASSWORD 'ownerpw'" `
  -c "CREATE DATABASE wickermoney_test OWNER wickermoney"

$env:TEST_ADMIN_DATABASE_URL = 'postgresql://wickermoney:ownerpw@localhost:5433/wickermoney_test'
$env:TEST_DATABASE_URL = 'postgresql://wickermoney_app_test:testpw@localhost:5433/wickermoney_test'
pnpm test:integration

docker rm -f wm-test-pg
```

To run one file, pass it through to Vitest:
`pnpm --filter @wickermoney/api test:integration src/plugins/externalPlugins.integration.test.ts`.
The roles the suite creates are cluster-wide, which is why a fresh container is
the cleanest way to get CI's starting state.

**PostgreSQL 16 only.** The suite is supported on 16, the version in every
compose file and in CI. A newer major version can fail on a test that asserts
plan text (`tenantContext.integration.test.ts` did on 18) without anything being
wrong in the app. Do not read such a failure as a regression; run the suite on 16.

**When it is red on `main`.** `:edge` and the tag wait for it. Fix forward or
re-run the workflow; do not remove the job from `ci.yml` to get an image out.

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

### Erasing data

Settings → danger zone has two actions. They are different code paths on purpose.

**Erase my data** (`POST /api/v1/settings/erase-my-data`, any signed-in user).
Needs the password and the phrase `erase my data`, checks the password with
`AuthService.confirmPassword`, then in one transaction as that user deletes
their rows from each plugin schema (as the plugin's own database role, so a
plugin's row-level security and grants apply as they do for its routes), then
from each core table, clears the setup-wizard record, and deletes their
sessions last. **Decision: the account row is kept.** Deleting the login too
is a different action with its own consequences (the email becomes free, the
last owner could leave), so it is not folded in here: sign in again and start
over, and add account deletion as its own action if it is wanted.

**Erase this entire instance** (`GET` and `POST /api/v1/settings/erase-instance`,
owners only). Row-level security shows an owner only their own rows and the app
role may not `TRUNCATE`, so this cannot be queries the API sends. It calls
`core.erase_instance()` (migration 032), a `SECURITY DEFINER` function that
re-checks the caller is an owner. It truncates `core.users`, every core table
with a `user_id` and every table in a `plugin_` schema, found in the catalog each
time. It leaves `core.plugins`, `core.app_deployments`, the tenant-context key
and migration bookkeeping alone. The API adds: the password, the phrase
`erase this instance`, a refusal while other sessions are live unless
`acknowledgeActiveSessions` is `true`, and two blockers (the preflight reports
them and the POST answers `409` with the same code):

| Blocker | When | Why |
| --- | --- | --- |
| `registration_disabled` | `REGISTRATION_ENABLED=false` | nobody could register a first owner |
| `bootstrap_owner_mismatch` | `BOOTSTRAP_OWNER_EMAIL` is another address | only that address could become owner |

After an erase the first registration becomes the owner under migration 028's
rules.

**Adding a table that holds user data.** A table with a `user_id` column must be
named in `apps/api/src/settings/service/ERASE_PLAN.ts`: a core table in
`CORE_ERASE_ORDER` (children before parents), a plugin table in that plugin's
entry in `PLUGIN_ERASE_PLANS`. A new bundled plugin schema needs an entry too.
There is no hook in the plugin SDK for this. The erase compares the plan with
the catalog in the same transaction and, if a `user_id` table is missing, answers
`500 erase_unplanned_tables` and deletes nothing, and
`settings/eraseMyData.integration.test.ts` fails in CI. The instance erase needs
nothing from you: it reads the catalog. `testing/eraseFixtures.ts` must also
reach the new table through the API so the tests prove it was emptied.

**Limits.** `settings/eraseInFlight.integration.test.ts` holds a write open at
a chosen point, runs the erase and lets the write go, so these are measured, not
assumed.

- *A write that is open when "Erase my data" starts* is waited for. The erase
  first takes `SELECT ... FOR UPDATE` on the user's `core.users` row, and
  inserting any row that belongs to the user holds a shared lock on that row
  until the writer commits. The erase queues behind the writer and then deletes
  what it committed. Before this lock the insert was invisible to the erase and
  committed after it, leaving a row (or, for a row that points at an account,
  making the erase fail with `500` on the `RESTRICT` key and delete nothing).
- *A request that passed its session check before the erase and writes after it*
  is not stopped. Access tokens are checked against their session at the start
  of each request, so ending the sessions rejects every later request at once,
  but a request already past that check still commits. It can leave one row
  for a user who has just been signed out, in a table with no parent row to
  refuse it (an account, a category, a plugin's own table). A row that points at
  something the erase deleted is refused by its foreign key. The next erase
  removes the stray row. Closing this would need every write to re-check its
  session inside its own transaction; that is not done.
- *Erase this instance* has neither problem. `TRUNCATE` waits for any open
  write, and a write that runs after it fails on the foreign key to
  `core.users`.

### Exporting data

Settings → Export all data (and the "Download my data first" button in each
erase dialog) downloads everything the signed-in user owns as one JSON file.
It asks for the password again first, for the same reason the erase actions
do: a valid access token proves a session, not that the person at the keyboard
knows the password, and the export is the largest read the API offers.

It takes two requests:

1. `POST /api/v1/settings/export-ticket` with `{ "password": "..." }` checks the
   password with `AuthService.confirmPassword` and answers
   `{ "ticket": "...", "expiresAt": "..." }`. A wrong password is
   `403 password_incorrect` with the issue on `password` (not 401: the web
   client reads that as an expired session). Attempts go through the same
   per-user limiter as the erase actions (`AUTH_EMAIL_RATE_LIMIT_MAX` per
   `AUTH_RATE_LIMIT_WINDOW_SECONDS`, `429 rate_limited`), so guessing across
   the three routes shares one allowance.
2. `GET /api/v1/settings/export` with the usual `Authorization: Bearer` header
   and the ticket in `x-wickermoney-export-ticket`. Without a ticket it is
   `403 export_confirmation_required`; with one that is unknown, expired, used
   or someone else's, `403 export_ticket_invalid`.

A ticket is 256 random bits, valid for **two minutes**, for **one** download,
for the user and the session (the token's session family) it was issued to. A
different user, or the same user signed in on another device, is refused and
the ticket stays usable by its owner. Redeeming is atomic, so of several
simultaneous requests with one ticket exactly one is served. A user holds at
most five live tickets; a sixth drops the oldest.

`curl` and scripts that used to call `GET /api/v1/settings/export` with an
access token alone now make the `POST` first (see the CHANGELOG, Breaking).

Plugin tokens can do neither: both routes are classified as denied in
`pluginRouteAccess.ts`, so a plugin token is refused with
`403 plugin_route_denied` before the ticket is looked at (and a ticket sent
with one is left unspent).

**Where tickets live.** In the API process's memory (`ExportTicketService`),
as a SHA-256 digest of the ticket, like the rate limiter's counters. A restart
drops outstanding tickets, which means confirming the password again. An
installation that runs several API processes behind one address would need
requests for the export to reach the process that issued the ticket, or a shared
store; neither exists today. Nothing is written to the database, so there is no
migration.

### Debt payoff

**Debt payoff** (bundled plugin `plugins/debt-payoff`, id `wickermoney.debt-payoff`)
keeps a list of debts and builds a payoff plan from them, by the snowball
(smallest balance first) or avalanche (highest rate first) method. It has a
server half (tables, endpoints and the planning engine) and a browser half: a
"Debt payoff" page in the main navigation and a "Debt-free date" dashboard
widget, built as a Module Federation remote like Budgets. The page lists the
debts (a table, and cards on a phone), adds and edits them in the shared
dialog, takes the strategy and the extra amount, and shows the totals, a
balance chart with a "Show as table" view, the payoff order and the
assumptions below. The page does no money arithmetic: it asks `GET /plan` and
shows the result.

It has its own tables in the `plugin_debt_payoff` schema (migration 030):
`debts` (name, balance, APR, minimum payment, optional linked account, sort
order, archived) and `plan_settings` (the saved strategy and monthly extra).
Money is `numeric(19,4)` in PostgreSQL and a decimal string in TypeScript.
Both tables are under forced row-level security, and a debt's account link is a
composite `(user_id, account_id)` key into `core.accounts`, so a debt cannot
name another person's account even though foreign key checks bypass
row-level security. Deleting an account together with its history unlinks the
debt (`ON DELETE SET NULL (account_id)`); a plain delete is refused while a debt
is linked. The plugin reads `core.accounts` through an ordinary `requiredTables`
grant and nothing else of the host's; it never reads another plugin's tables.

Endpoints, under `/api/v1/p/wickermoney.debt-payoff`:

| Route | What it does |
| --- | --- |
| `GET /debts` (`?includeArchived=true`) | The list, in the person's own order |
| `POST /debts`, `GET/PUT/DELETE /debts/:id` | Create, read, change (partial; `accountId: null` unlinks) and delete |
| `GET /settings`, `PUT /settings` | Saved strategy (default `avalanche`) and extra (default `0`) |
| `GET /plan?strategy&extra&tz` | The plan; values not given in the query come from the saved settings |
| `GET /account-suggestions` | Loan and credit card accounts, with the debt already tracking each |

**How a plan is computed** (the engine is `src/shared/strategy`, pure functions
on the SDK's bigint `/money` maths, no floating point anywhere):

- Interest is the nominal APR compounded monthly: `balance * APR / 12`, on the
  balance at the start of the month, with the payment made at the month's end.
  A debt's last payment is therefore its balance plus that month's interest.
- **Rounding rule:** interest is rounded once per debt per month, to four
  decimal places, half away from zero (the SDK's `divideUnits`). Nothing else is
  rounded, so a plan's totals add up exactly.
- The same amount is paid every month: the sum of the minimums plus the extra.
  When a debt is paid off, its minimum rolls to the next debt in the order.
  The order is fixed at the start (snowball: balance, then rate, then list
  position; avalanche: rate, then balance, then list position).
- A minimum above what is owed pays only what is owed.
- The plan also carries a minimums-only baseline, so the response says how many
  months and how much interest the strategy saves.
- **Limits:** a plan stops at 600 months and reports `capped: true` with a
  `cappedReason` (`month_limit`, or `balance_limit` when a balance would pass the numeric
  ceiling, as with a minimum that never covers the interest). At most 50 active
  debts per person. Balances and payments are capped at 999,999,999,999,999.9999
  and a rate at 999.9999%.

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

Two of the seven bundled UI plugins (Insights, Spending Trends) and every
third-party plugin run in a sandboxed frame. The other five bundled plugins
(widgets and pages loaded over Module Federation) still run **fully trusted, in
the host's origin**. Read this before writing or reviewing anything
that talks about plugin "permissions", "scoping" or "sandboxing".

| Layer | What it does | Boundary against plugin code? |
| --- | --- | --- |
| Per-plugin PostgreSQL role (`plugin-roles.ts`) | Refuses queries outside the manifest's `requiredTables` | For **server-side** plugin code (bundled plugins' `runAsPlugin`) that behaves: a guardrail, not a sandbox, because crafted SQL can leave the role |
| `assertSafePluginSql` (the plugin query runner) | Refuses statement text that changes the role or session settings | **No.** It reads text, and a `DO` block with dynamic `EXECUTE` gets past it. It exists to catch mistakes |
| Row-level security | Keeps every query inside the signed-in user's rows | Yes, for tenants, including after the SQL leaves the plugin role (the tenant context is signed) |
| Plugin token + route classification (`auth/pluginTokens.ts`, `auth/pluginRouteAccess.ts`) | The server tells a plugin's request from the host's by a signed token, and gives that token only its plugin's granted `/core` reads and its own `/p/<id>/` routes | **Server side: yes.** The broker uses it for every plugin that runs in a frame. Plugins that run in the host page (the in-realm ones, below) do not use it, so for them: **no**. That code can still reach the host's own access token. See [Plugin tokens](#plugin-tokens) |
| Sandboxed frame and its document (`IsolatedPluginFrame`, `GET /plugin-frame`) | The UI of a plugin that is not in-realm runs in `<iframe sandbox="allow-scripts">`, whose document the API serves with `sandbox allow-scripts; default-src 'none'; connect-src 'none'; ...`: an opaque origin, so no host cookies, storage or DOM, and no direct network from script | **Yes, for the code in the frame**, with the exceptions listed in ADR 0005's verification log (Chromium sends some requests that CSP does not govern, such as `<link rel=prerender>` and WebRTC). See [Isolated plugin frames](#isolated-plugin-frames) |
| Broker (`apps/web/src/plugins/isolated/broker.ts`) | The only code that holds a plugin token. Checks the manifest grants and a path allow-list, then the per-user response cache, then the network; rate-limits and validates every message | **Yes**, it is the single door out of the frame |
| `x-wickermoney-plugin` header + `requireTableGrant` | Holds a host-token request that names a plugin to that plugin's manifest | **No.** Advisory: it can narrow a host request, never identify one, and a caller can omit it. A plugin token is never attributed by it |
| Scoped `ctx.api` client in `apps/web/src/plugins/context.ts` | Fails fast on an ungranted path | **No.** Developer ergonomics; plugin code can call `fetch` |
| `PLUGIN_REMOTE_ORIGINS`, the frame's CSP and the manifest `integrity` pin | A remote origin is allowed in the frame's policy only (never the page's), and the frame has the browser verify each pinned file before the plugin runs | They decide whose code may *load*; the frame and broker rows decide what it may *do*. A pin covers only the files it lists, and is only as good as where the operator took it from. See [Third-party plugins](#third-party-plugins-added-by-an-operator) |

Consequences for contributors:

- Do not describe `requiredTables` as protecting data from a UI plugin. It
  protects data from a plugin's server code.
- Do not describe the plugin role or the SQL screen as a sandbox for server
  code. They stop mistakes; row-level security is what holds against hostile
  SQL. Do not add patterns to `FORBIDDEN_SQL` to "close" the dynamic-SQL gap:
  a connection the plugin cannot leave is the real fix, and it belongs with
  plugin isolation.
- Do not rely on the plugin header for access control. A route that must not
  be reachable by plugins is closed by classifying it as denied for plugin
  tokens (next section), which the header cannot undo.
- There is still no install flow, catalog or signing for third-party plugins.
  `PLUGIN_REMOTE_ORIGINS` and `PLUGIN_MANIFEST_DIR` stay empty by default, and
  nothing about start-up changes when they are. Do not write docs that say
  isolation makes a third-party plugin *safe*: it contains the plugin's UI, with
  the known gaps in ADR 0005, and server-side plugin code stays first-party
  only (ADR 0007).
- The SDK defines the contract for isolated UI plugins
  (`@wickermoney/plugin-sdk/isolated`, experimental) and the web app hosts it.
  Which plugins run where is decided by the API (`pluginRuntimeFor`): a plugin
  runs in the page only if it is a bundled plugin listed in `IN_REALM_PLUGIN_IDS`
  (`apps/api/src/plugins/bundled.ts`), and in a frame otherwise. `insights` and
  `spending-trends` have been ported and run in frames. The other five bundled
  plugins (`budgets`, `import-csv`, `upcoming`, `forecast`, `debt-payoff`) are
  still listed and run in the page, fully trusted. The list shrinks as plugins
  are ported.

### Isolated plugin frames

A plugin whose runtime is `isolated` (everything not in `IN_REALM_PLUGIN_IDS`,
plus any bundled plugin whose manifest says `isolated: true`) never loads into
the host page. `GET /api/v1/plugins` reports each plugin's `runtime` beside its
manifest; the web app treats anything but an explicit `in-realm` as isolated, and
does not register an isolated plugin's remote with its own Module Federation
runtime (`loadPluginModule` refuses it too).

```mermaid
sequenceDiagram
  participant P as Host page
  participant B as Broker (host)
  participant F as Frame (opaque origin)
  participant A as API
  P->>F: iframe src=/plugin-frame#id,entry,module,kind
  A-->>F: frame document + CSP (sandbox allow-scripts, connect-src none)
  F->>P: wm.hello (window message)
  P->>F: wm.connect + MessagePort (only if event.source is this iframe)
  F->>B: ready (port)
  B-->>F: init (session, locale, theme, size/range)
  F->>B: request GET /core/transactions/...
  B->>B: grants, path allow-list, then per-user cache
  B->>A: mint plugin token (host credentials), then the request with the plugin token only
  A-->>B: response
  B-->>F: response
```

- **The frame document** is `GET /plugin-frame` (`registerWebApp`), built from
  `apps/web/plugin-frame.html` by a second Vite build (`vite.frame.config.ts`)
  into the same `dist`. It has its own CSP built per request
  (`buildFrameContentSecurityPolicy`), `cache-control: no-cache`, and is not
  served by the static handler. The target plugin travels in the URL fragment, so
  the document is one file for every plugin. Assets and plugin files under
  `/assets/` and `/plugins/` carry `access-control-allow-origin: *`, because a
  sandboxed frame fetches its modules in CORS mode from an opaque origin. That
  header is only for public build output; API routes get none.
- **Who may connect.** The host's `message` listener accepts a `wm.hello` only
  when `event.source` is that iframe's `contentWindow`. It never looks at
  `event.origin`: every sandboxed frame's origin is the string `"null"`. After the
  handshake the `MessagePort` is the credential. A frame that reloads itself says
  hello again and gets a fresh port, but not a fresh rate limit.
- **The broker** runs, per request: path and grant check (a `/core` read of a
  granted table, or the plugin's own `/p/<id>/`; nothing else, no dot segments or
  encoded separators) → body size → the same per-user response cache the in-page
  client uses (5 s, cleared by any write) → the network with the plugin token as
  the only credential (`credentials: 'omit'`). The check comes first on purpose:
  a cache hit never reaches the server, so the server's default-deny cannot refuse
  it. The token is minted lazily with the host's credentials, refreshed 30 s before
  it expires, re-minted once on a 401, and never sent over the port. If the signed-in
  user changes, the connection is cut. A frame that floods the port, sends malformed
  or oversize messages, or re-handshakes too often is rate-limited and then cut off.
- **Size.** The host owns the width (the slot's grid); the frame reports its
  content height and the host clamps it: widgets 96–800 px, pages 240–20 000 px.
- **Theme and locale.** `init` carries the `--wm-*` tokens and the scheme read from
  the host page; a new `theme` message follows any change of `data-theme`, the
  root's style or the operating system preference. The frame applies them with
  `applyHostTheme`.
- **Focus.** A frame cannot hand focus to the page around it, so the in-frame app
  reports Tab at its first or last control (`focus-out`) and the host moves focus
  to the next or previous control on the page. `focus-in` goes the other way.
- **Dialogs and overlays.** Protocol 1 has no host-rendered dialog (the decision
  recorded with the protocol). A dialog inside a widget frame is clipped by the
  frame, so a widget that needs one navigates to a page (`navigate`), whose frame
  is full height. The broker ignores a `dialog` message like any unknown type.
- **One frame per widget.** A frame is one rectangle, and a plugin's widgets sit
  in different cards and slots, so a frame per plugin could not place them. The
  measured cost is in the 0.6.0 plan; on Chromium 141 it was about 9 MiB and
  150 ms for each frame after the first.
- **Lazy start.** A widget's iframe is not created until its card is close to
  the viewport (`useNearViewport`, used by `IsolatedPluginFrame`; pages are never
  lazy). Until then the card holds a plain-text placeholder whose height is an
  estimate for the widget's size (`PLACEHOLDER_HEIGHT`: `sm` 160, `md` 360,
  `lg` and `full` 400 px, from the bundled chart widgets), and the frame starts
  at the same height, so the card does not jump when the frame arrives. The
  rules, with the reason for each:
  - **Margin: 600 px above and below the viewport** (`FRAME_ROOT_MARGIN_PX`). A
    frame needs the frame document, the plugin's chunk and a first read; on the
    seeded dashboard that was 150 ms to over a second. 600 px is a bit under a
    phone screen, so the frame has usually drawn by the time a normal scroll
    reaches it, while the cards further down stay unstarted. The margin only
    reaches a scroll root that is the viewport (the app scrolls the window; a
    widget inside an inner scroll container would need that container as the
    observer's root).
  - **A card is measured again before it starts.** Starting a frame cannot be
    undone and the layout is not final at first render: the in-page cards are
    spinners and a frame reports a small height while it loads, so cards below
    sit too high. A card in view starts after 250 ms (`SETTLE_MS`) if it is still
    in view; a card that is only inside the margin is held until 2.5 s after the
    page loaded (`LAYOUT_SETTLED_AT_MS`), then starts if it is still inside. Both
    waits are visible only for cards that are off screen or have just arrived. On
    the seeded dashboard, without this every frame started at load. Coming back
    to the dashboard later, or scrolling, uses the short wait.
  - **No `IntersectionObserver`: every frame starts at load**, as before.
  - **A started frame is kept** when it is scrolled far away. Destroying it would
    throw away its state (open table, scroll position, a tooltip), pay the start
    again (about 150 ms and a token and a read) and flash a spinner on every
    scroll back, to win back a few MiB for a dashboard that has a handful of
    widgets. Revisit if a dashboard ever has dozens of frames.
  - **The handshake clock** ("The plugin did not start in time", 15 s) starts when
    the frame is created and stops while the document is hidden, resuming with the
    time it had left. A background tab throttles the frame's timers, so a slow
    frame there has not shown it is broken, and a frame created in a hidden tab
    does not count until the tab is shown. The clock for a frame that is not
    created yet does not exist.
  - **Keyboard and screen reader.** The placeholder is plain text: not focusable,
    not a live region, so Tab passes over it and nothing is announced for a card
    the user has not reached. A frame that has not started (or has but is not
    ready) is not a Tab stop, so Tab from the control above a card that is still
    waiting goes to the next control after it; the browser scrolls that control
    into view, which starts the card, and Shift+Tab then reaches it. Nothing moves
    focus into a frame because it started (`focus-in` is only sent on request).
    A screen reader's virtual cursor reaches the placeholder text and the browser
    scrolls to it, which starts the frame; the frame's title then announces as
    before.
  - **Find in page and print only see frames that have started.** Text in a card
    that is still a placeholder is not found, and a print preview of a dashboard
    that was not scrolled shows placeholders for those cards. Scroll to the
    bottom first (or open the page in a tall window) when you need either.
  - **Test hooks.** `apps/web/browser-check/lazyFrames.ts` checks the behaviour on
    the seeded dashboard and measures it against an earlier build (see
    `apps/web/browser-check/README.md`).

  Measured on the seeded `hero` dashboard (6 widgets: 3 in frames, Insights twice
  and Spending Trends; the others in the page), Chromium 153, headless, the API
  and browser on one shared 2-CPU container, so the absolute numbers are noisy
  and only the before and after on the same run mean anything. Median of 7 runs,
  before and after alternated run by run, one discarded warm-up each. "First
  widget" is the first card with its content, "first screen" is all cards that
  start inside the window; memory is the proportional set size of the browser's
  process tree, 3 s after the last widget settled.

  | 1280x900 | before | after |
  | --- | --- | --- |
  | Time to first widget | 894 ms | 803 ms |
  | Time to all widgets in the first screen | 1252 ms | 1027 ms |
  | Iframes at load / after scrolling to the bottom | 3 / 3 | 2 / 3 |
  | Browser memory at load | 409 MiB | 406 MiB |
  | Browser memory after scrolling to the bottom | 412 MiB | 420 MiB |

  | 390x844 (phone) | before | after |
  | --- | --- | --- |
  | Time to first widget | 791 ms | 746 ms |
  | Time to all widgets in the first screen | 1081 ms | 762 ms |
  | Iframes at load / after scrolling to the bottom | 3 / 3 | 1 / 3 |
  | Browser memory at load | 393 MiB | 375 MiB |
  | Browser memory after scrolling to the bottom | 395 MiB | 401 MiB |

  The gain is small on this dashboard, and it is honest to say so: at desktop size
  one of three frames is deferred and saves about 3 MiB; on a phone two are
  deferred and save about 18 MiB (about 9 MiB each, as in the 0.6.0 measurement),
  and the first screen was about 300 ms quicker, probably because it no longer
  shares the network and CPU with frames that are not on it (not isolated further). A user who scrolls to the
  bottom ends up 6 to 8 MiB above the eager page: a frame started later carries
  the same cost plus the second pass at layout. The feature pays most on
  dashboards with more frame widgets than fit a screen.

- **Development.** In `pnpm dev` the page comes from Vite but the frame is
  still the API's document, so it needs the built web app. Vite's dev server
  proxies `/plugin-frame` and `/assets` to the API on `:8080`, and `/plugins` for
  requests that come from a frame (`Origin: null`), so the frame gets its real
  policy, sandbox header and CORS headers, as in production. Without the proxy
  Vite answers `/plugin-frame` itself, with its HTML fallback and no policy, and
  every module it then serves is refused for the frame's opaque origin (CORS), so
  the widget shows "The plugin did not start in time". The setup, once:

  ```bash
  pnpm --filter @wickermoney/web build   # apps/web/dist, with plugin-frame.html
  # in .env, uncomment WEB_DIST_DIR=../web/dist (relative to apps/api)
  pnpm dev
  ```

  The API then serves the built app on `:8080` as well, which you can ignore.
  What this costs you: a frame runs the **built** copy of its code, so there is no
  hot reload inside it. After changing the frame (`apps/web/src/frame`), the
  SDK's isolated entry or a plugin that runs in a frame (`insights`,
  `spending-trends`), run the `build` line again and reload. Plugins that run in
  the page are unchanged: Vite serves them from `apps/web/public/plugins`, which
  their watch builds rewrite. If the frame fails to start, the browser console
  names the likely cause (no built frame, API not running, something other than
  the API answering `/plugin-frame`).

  Do not "fix" this with `server.cors` set to the origin `null`. It makes the
  widgets load, but `null` is the origin of every sandboxed iframe and `data:`
  page on any site, so any page open in the same browser can then read the dev
  server's source (the hole Vite closed in 6.0.9). The frame would also be
  Vite's own document, with no policy: it could do in development what
  production refuses, and a policy violation (like the `eval` check zod made)
  would only show up in a release build. To exercise the sandbox itself, run
  `pnpm --filter @wickermoney/web test:browser`, which builds a fixture plugin
  that tries to escape and drives Chromium through the real API. It is not part of
  `pnpm test`.

**Porting a plugin (what Insights needed).** A component written against
`PluginWidgetProps` runs unchanged; the work is in what it imports and where it
draws.

- Import from `/runtime`, `/money` and `/date`, never the SDK root. Every frame
  downloads and parses its plugin's chunk on its own, so the root's Zod schemas
  (about 85 kB) cost once per frame, not once per page.
- Keep tooltips, menus and popovers inside the widget's own rectangle. A frame
  cannot draw outside it and protocol 1 has no host-rendered overlay, so an
  overlay that crosses the edge is cut off. Measure the overlay and clamp it
  (Insights' `TrendTooltip`), or `navigate` to a page.
- Bound anything whose height grows with the data. A widget frame is at most
  800 px tall; past that the frame scrolls on its own, a second scroll area
  inside the card.
- A widget frame below the fold is not laid out until it is scrolled into view
  (Chromium throttles the rendering of off-screen cross-origin frames), so a
  `ResizeObserver` alone never fires there. `observeSize` also re-reads the
  height every 250 ms, which is how an off-screen frame gets its height. Use
  `observeSize` rather than your own observer, and do not call `reportSize`
  from a `ResizeObserver` only.
- The frame's document has only the ui-kit styles and the plugin's own;
  `adoptPluginStyles` writes to the frame's document, which works because the
  frame CSP allows inline style.

`apps/web/browser-check/insights.ts` runs the real dashboard with Insights in
the page and in a frame and compares them (sizes at `sm` to `full`, light and
dark, desktop and phone width, clipped overlays, Tab order, the table view,
axe, and timing and memory). See `apps/web/browser-check/README.md`.

### Hostile plugin suite

ADR 0005's trust boundary is only worth what it survives, so a plugin written to
misbehave runs against it on every pull request. `pnpm test:hostile` runs
four parts, and CI runs them as the required check **Hostile plugin suite**.

- **Server half** (`apps/api/src/plugins/hostilePluginToken.integration.test.ts`,
  PostgreSQL). The route classes a plugin token must be refused on are written
  out in the test, a second statement of `PLUGIN_ROUTE_ACCESS`: authentication,
  settings, export and the erase routes, plugin management and token minting,
  owner role management, and the host's own data screens. Each is called with a
  valid plugin token, the CSRF header and the refresh cookie, and has to answer
  `403 plugin_route_denied`, with data, roles, plugins, the session and the
  password unchanged afterwards. Moving a route out of the denied set is an edit
  in two files on purpose. It also covers a token's other ways to fail: expired,
  past its maximum age, tampered, `alg: none`, signed with another key, revoked by
  logout or a password change, minted for another plugin, and used after the
  plugin is disabled.
- **Browser half** (`apps/web/browser-check/hostile/`, Chromium). A hostile
  widget runs beside an honest neighbour frame and attempts about 140 things:
  reading the host token or cookies, `fetch`, XHR, WebSocket, `sendBeacon`, images,
  fonts, workers, nested frames, forms, popups, top navigation and `ctx.navigate`
  to hostile paths, every route above through the broker and with a stolen token,
  malformed, oversized and flooding messages, forged handshakes, and being
  disabled while open. Each is judged by what a server on another origin, the
  API and the browser report, never by the plugin's own account. See
  `apps/web/browser-check/README.md`.
- **Remote-origin half** (`apps/web/browser-check/hostile/remote.ts`, Chromium,
  needs `openssl` for a throwaway certificate). A real federated build is served
  over https from a second origin and listed with a pin: a matching build loads in
  the frame and only there; a changed chunk and a changed entry are refused before
  any of their code runs; an origin that is not allowlisted is blocked and gets no
  request; crafted manifests are refused or stay isolated. `pnpm test:hostile`
  runs it after the hostile browser half.
- **Eval-violation half** (`apps/web/browser-check/hostile/evalViolations.ts`,
  Chromium). The hostile plugin evals on purpose; this loads the bundled Insights
  and Spending Trends widgets in their frames, with no fixture, and fails on any
  eval-blocked Content Security Policy violation from the page or a frame (zod's
  `new Function("")` probe was one). A canary eval must be seen, so a broken
  recorder cannot pass. `pnpm test:hostile` runs it last.

Two unit tests belong to the same gate and run in `pnpm test`:
`sandboxAttributes.test.tsx` (the sandbox attribute is exactly `allow-scripts`,
and `allow-same-origin` appears nowhere in code) and
`plugins/service/permissions.test.ts` (every `PERMISSIONS` value is implemented
or refused at load, and a manifest that declares a refused one fails to load with
a reason that names it).

Needs `pnpm build`, a test database (see above) and Chromium. In CI the browser
comes from `playwright-core install chromium`; in a sandbox that ships one,
point `CHROMIUM_PATH` at it and do not install another. Expect about 2.5
minutes for the browser half and under 10 seconds for the server half on a
laptop; the CI job, including install, build and browser download, took 4
minutes 1 second on its first green run, next to 3 minutes 18 seconds for the
main job (measured 2026-10-11, before the API integration job from #83
existed). The suite launches Playwright's full Chromium (`channel: 'chromium'`),
not the headless shell, because the frame handshake ("The host did not send
init in time") never completes in the headless shell. A channel the frame policy
does not govern is
**pinned** in the browser half: a browser upgrade that closes or opens one fails
the suite so that the ADR table is updated with it.

The pinned channels (`<link rel=prerender>`, WebRTC STUN and TURN, and the frame
navigating itself to a URL on the app's origin) were spiked for a control that
closes them (ADR 0008, measured 2026-10-22 in Chromium 141.0.7390.37 against the
frame document as the API serves it). None is closed by a `Permissions-Policy`
header or the iframe `allow` attribute (set to none for each of the 77 features
that browser lists, and an empty `allow=""`), by `Cross-Origin-Embedder-Policy`,
`-Opener-Policy` or `-Resource-Policy`, or by the CSP directives `webrtc`,
`prefetch-src` and `navigate-to` (Chromium does not implement them: it logs
"Unrecognized Content-Security-Policy directive"). A script that deletes
`RTCPeerConnection` from the frame stops direct use but not an `about:srcdoc`
frame, which has its own copy. Only the self-navigation can be stopped, by
limiting the page's `frame-src` to the frame document's path, which needs the
browser's exact address and so is not shipped. `allow` stays unset, and the suite
still asserts that. When a browser ships a control, add it to the frame document
and change the pin in `RESIDUAL_PINNED` in the same commit.

The browser half also fails if a frame document sends `Origin-Agent-Cluster` or
the console logs an agent-cluster warning while the frames load: a sandboxed
document cannot be origin-keyed, and Chromium warns about each one that asks.

### Third-party plugins (added by an operator)

There is **no install flow, no catalog and no signing**. The only way in is the
operator's own hands, and it is deliberately small.

```mermaid
flowchart LR
  D[PLUGIN_MANIFEST_DIR<br/>*.json, read once at boot] --> R[readManifestDirectory<br/>files only, size and count caps,<br/>no bundled id]
  R --> A{PluginService admission}
  A -->|parseManifest, refused permission,<br/>server code, origin, pin| X[Refused: reason on the plugin list]
  A -->|ok| S[Registered switched off]
  S -->|owner enables| F[Isolated frame only]
  O[PLUGIN_REMOTE_ORIGINS] -.->|frame CSP only| F
```

1. Host the plugin's build on an https origin that sends
   `Access-Control-Allow-Origin` (the frame fetches in CORS mode from an opaque
   origin), and put the origin in `PLUGIN_REMOTE_ORIGINS`.
2. Copy its manifest into `PLUGIN_MANIFEST_DIR` with an `integrity` map for
   **every** `.js` file of the build, then restart the API. The directory is read
   once; there is no reload.
3. Switch the plugin on as an owner (`PATCH /api/v1/plugins/:id`, or the plugin
   list). It is registered off, and a restart does not turn it back on or off.
   The plugin list asks the owner to confirm first (`EnablePluginDialog`); a
   bare `PATCH` does not. The dialog's text follows `SECURITY.md`, so change
   them together. It needs the `origin` and `tables` that
   `GET /api/v1/plugins/registry` reports for each plugin.

Make the pin from the files you reviewed, not by fetching them from the origin:

```bash
cd path/to/the/build
find . -name '*.js' | sed 's#^\./##' | sort | while read -r f; do
  printf '"%s": "sha384-%s",\n' "$f" "$(openssl dgst -sha384 -binary "$f" | openssl base64 -A)"
done
```

```powershell
Get-ChildItem -Recurse -Filter *.js | ForEach-Object {
  $hex = (Get-FileHash -Algorithm SHA384 $_.FullName).Hash
  $b64 = [Convert]::ToBase64String([byte[]]($hex -split '(?<=\G..)(?=.)' | ForEach-Object { [Convert]::ToByte($_, 16) }))
  '"{0}": "sha384-{1}",' -f ($_.FullName.Substring($PWD.Path.Length + 1) -replace '\\', '/'), $b64
}
```

What the code enforces, each with the test that says so:

| Rule | Where | Test |
| --- | --- | --- |
| A non-bundled manifest has no `endpoints` or `exporters`, and never gets in-realm mode | `service/admission.ts` (`serverCodeRefusal`), `pluginRuntime.ts` | `externalPlugins.test.ts`, `pluginRuntime.test.ts`, `externalPlugins.integration.test.ts` |
| An entry the host does not serve is always isolated, whatever `isolated` says | `pluginRuntimeFor`, `isHostServedEntry` | `pluginRuntime.test.ts` (crafted values included) |
| The page never registers a remote entry | `apps/web/src/plugins/registerOne.ts` | `loader.test.ts` |
| The page's CSP does not name a plugin origin | `buildContentSecurityPolicy` | `buildContentSecurityPolicy.test.ts`, `registerWebApp.test.ts` |
| A plugin the image did not ship, or a remote entry, needs a pin that lists its entry file | `admission.ts` (`pinRefusal`), `checkRemoteEntryIntegrity` | `integrity.test.ts`, `PluginService.test.ts` |
| The browser verifies every pinned file before the runtime starts; a remote entry with no pin is not loaded | `apps/web/src/frame/verifyPinnedFiles.ts` | `verifyPinnedFiles.test.ts`, and `hostile/remote.ts` in Chromium |
| A manifest never replaces a bundled id; files only, capped | `manifestDirectory.ts` | `manifestDirectory.test.ts` |
| An origin outside `PLUGIN_REMOTE_ORIGINS` is not loadable and receives no request | frame CSP, `checkRemoteEntry` | `hostile/remote.ts`, `PluginService.test.ts` |

**What a third-party UI plugin can do:** read the eight `GET /api/v1/core/*`
routes for the tables in its `requiredTables`, and nothing else. No endpoints,
exporters, storage or scheduled work (ADR 0007), and a `write` grant on a core
table has no route it can use.

**Limits of the pin**, which the docs must keep saying: only listed files are
checked (a file the entry loads that you did not list loads unchecked); style
sheets are not covered; the pin travels to the frame in the URL fragment, which
decides what the *host* loads, and a plugin that is already running hostile code
gains nothing from changing it; a manifest taken from the server that serves the
code proves nothing; Chromium 141 only.

### Plugin tokens

A plugin token is a short-lived JWT that speaks for one plugin. It exists so
the server can tell a plugin's request from the host's without trusting a
header. It is the server half of plugin isolation: the host's broker (see
[Isolated plugin frames](#isolated-plugin-frames)) holds it for a sandboxed
plugin, so the plugin never sees the user's own access token. The web app mints
and sends a plugin token only for plugins that run in a frame. A plugin running
in the host page (the in-realm ones) does not use one, and can still reach the
host's own access token, so these tokens do not make in-page plugin code safe.

**Minting.** `POST /api/v1/plugins/:pluginId/token` needs the user's own access
token (a plugin token cannot mint another) and returns
`{ token, expiresAt, pluginId, grants }`. It answers `404 not_found` for an id
nobody registered and `404 plugin_disabled` for a plugin that is switched off or
whose manifest does not load. Nothing is stored.

**What is in the token.** Same key, issuer and algorithm (HS256) as an access
token, but audience `<AUTH_AUDIENCE>:plugin`, so neither kind verifies as the
other. Claims: `sub` and `email` (the user), `sid` (the session it was minted
under), `plg` (the plugin id), `tbl` (the plugin's `requiredTables`, `write`
beating `read`), `jti`, `iat` and `exp`. It lives five minutes and a token older
than fifteen is refused whatever it says. Because it carries `sid`, logging out
or changing the password ends it with the session.

**What it can reach.** Default deny, decided in one file,
`apps/api/src/auth/pluginRouteAccess.ts`, by the route's registered pattern:

- the eight `GET /api/v1/core/*` reads, each mapped to the tables it needs
  (`upcoming` and `forecast` need `recurring_items` and `accounts`);
- everything under `/api/v1/p/<the plugin's own id>/`.

Everything else answers `403 plugin_route_denied` before its handler runs:
`/auth/*`, `/settings/*` (including the export), `/plugins/*` (including
minting), `/users/*`, the host's own accounts, categories, rules, transactions,
onboarding and recurring-item routes, and every other plugin's namespace. An
owner's plugin token has no owner powers.

On a route it may reach, the server also checks that the plugin is still enabled
(`403 plugin_disabled`) and holds each needed table at the needed level
(`403 grant_denied`). The grants it applies are the token's, narrowed to the
plugin's *current* manifest, so a manifest that has since lost a table takes
effect before the token expires. An expired, forged or revoked token answers
`401`, like any access token.

**Adding a route.** Add it to `PLUGIN_ROUTE_ACCESS` in the same change: `DENIED`
for almost everything, or `needs([table, access], ...)` for a `/core` read a
plugin should get. A route left out is denied, and `pluginRouteAccess.test.ts`
fails until it is listed (it also fails on an entry for a route that no longer
exists, and on a plugin namespace for a plugin that is not bundled). The guard
for a plugin-accessible route is `requireTableGrant`, or `app.requireActor` for
a plugin's own routes; `requireAuth` accepts the host's access token only.

### When a plugin is turned off

An owner can turn any plugin off from Settings → Plugins. The host unmounts the
plugin's pages and widgets (a remote already loaded stays in memory but is no
longer rendered), its own routes answer `404 plugin_disabled`, and a core data
request carrying its `x-wickermoney-plugin` header gets `403 grant_denied`. A
plugin token for it answers `403 plugin_disabled` on every route.
(A request made with the host's token that omits the header is not attributed
to the plugin, so a disabled plugin's already-loaded code is not stopped from
calling core routes; see [Plugin trust model](#plugin-trust-model).)
Its schema, rows and role are kept ("Erase my data" still empties them for the user; see [Erasing data](#erasing-data)). Do not assume a plugin's code runs at
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

### End-to-end tests

`e2e/` holds browser tests that run against the **built image**, the way someone
who pulls it runs it, rather than against the source tree. Seven smoke specs
(`e2e/tests/smoke.spec.ts`, about 25 seconds once the stack is up) cover: the
stack is healthy, migrated and seeded (all four seed personas sign in, the
bundled plugins registered with no load failures); `hero` signs in and reaches the
dashboard; `household` reaches the forecast page; every in-realm bundled plugin
page loads with no console error or failed request; every dashboard widget
loads, and the isolated ones (Insights, Spending Trends today) run in frames with
no console error and no Content Security Policy violation; `hero` cannot read
`household` data through the API or the UI; and a transaction added in the
Transactions dialog appears in the ledger and lowers the dashboard's "Safe to
spend". The plugin lists come from `GET /api/v1/plugins` at run time, not from a
copy in the specs, so a plugin that moves between runtimes changes what is
checked and not whether the specs pass. The seed anchors its dates to the day it
runs, so the specs assert relatively (a difference of 123.45, a row they just
created) and never against a fixed date.

**Running it.** The stack is `docker/docker-compose.e2e.yml`: the image you name
in `E2E_IMAGE`, PostgreSQL 16 on tmpfs, one-shot `migrate` and `seed` services
(the seed is the compiled CLI already in the image, `dist/db/seed/seedCli.js`, so
nothing was added to the image for this), no published port, and a `playwright`
service (profile `test`) on the official Playwright image. Everything is thrown
away afterwards. The passwords in it are public test values that pass the API's
placeholder-credential check under `NODE_ENV=production`; the sign-in rate limits
are raised for this stack only.

```powershell
# Windows, Docker Desktop: builds wickermoney:e2e from this checkout, runs, tears down
.\e2e\run.ps1
# a published image instead of a build
.\e2e\run.ps1 -Image ghcr.io/wickermoney/wicker-money:edge
```

```bash
e2e/run.sh                                        # build, run, tear down
E2E_IMAGE=ghcr.io/wickermoney/wicker-money:edge e2e/run.sh   # test the :edge tag
e2e/run.sh -- tests/smoke.spec.ts                 # arguments after -- go to playwright test
```

To work on a spec with a browser on the host, publish a port and point the
package at it. On the host you need a Chromium once:
`pnpm --filter @wickermoney/e2e exec playwright install chromium` (a deliberate,
local step; the install itself never does it), or `PW_CHROMIUM_PATH` for one you
already have:

```bash
export E2E_IMAGE=wickermoney:e2e
docker compose -f docker/docker-compose.e2e.yml -f docker/docker-compose.e2e.ports.yml up --wait --detach
BASE_URL=http://127.0.0.1:8190 pnpm test:e2e
docker compose -f docker/docker-compose.e2e.yml down --volumes
```

**Debugging a failure.** A failed spec keeps a trace and a screenshot in
`e2e/reports/` (git-ignored; `html/index.html` is the report, `junit.xml` the
machine-readable result; CI retries once). Open the trace with
`pnpm --filter @wickermoney/e2e exec playwright show-trace <path>/trace.zip` and
step through the page, network and console. The runner scripts print the app's
log tail on a failure.

**Why a package of its own, and how it relates to the hostile suite.** Playwright
is not a dependency of anything that `pnpm test`, `pnpm build` or the image
needs: `@playwright/test` lives only in `e2e/`, which has no `test` or `build`
script, so turbo never runs it, and Playwright does not download a browser when
it is installed. The browser comes from the Playwright container image in the
compose stack, or from one you point at on a machine that has one
(`PW_CHROMIUM_PATH`, or `CHROMIUM_PATH` as the hostile suite spells it); never
run `playwright install` in a cloud clone that ships a Chromium.

The hostile plugin suite ([above](#hostile-plugin-suite)) has its own driver
(`apps/web/browser-check/hostile/`, `playwright-core` with its own server and
fixture plugin) and stays as it is. The two share a Playwright version and a
Chromium choice: both pin the exact same version (1.64.1; `pnpm typecheck` in
`e2e/` fails if `e2e/package.json`, `apps/web/package.json` or the compose image
tag disagree, so bump them together) and both use Playwright's **full**
Chromium (`channel: 'chromium'`), never the headless shell, because the frame
handshake never completes in the shell and the dashboard's isolated widgets would
not load. They could share a stack later: the hostile suite would have to move
from `playwright-core` scripts, a server it starts itself and a fixture build to
`@playwright/test` specs against a running stack, and it needs things the e2e
stack deliberately lacks (a second origin, a fixture plugin, direct database
access for its server half). Until that is worth doing, one is a
smoke test of the shipped image and the other is an attack harness, and neither
needs the other's setup.

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
`next` tag, the image gets only its version tag (`:0.1.0-rc.1`) and never takes
`:latest`, and the release is marked as a prerelease. There is no `:next` image
tag: it would trail `:latest` after every stable release, so a candidate is
tested by pinning its version tag. Re-running the packages job after a partial
failure is safe; a version the registry already has is skipped.

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
nothing. `:edge` is not a release: it never takes `:latest` or a version tag, publishes
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
  `:latest`, `:edge` or a stable version tag. It deletes `:edge-<short sha>`
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
