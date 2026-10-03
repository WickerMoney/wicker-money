# Wicker Money

Self-hostable personal finance, rebuilt as a thin core plus installable plugins.

The core owns identity, money movement and the app shell. Everything that
*interprets* money — budgets, forecasting, net worth, FIRE, importers — is a
plugin built against `@wickermoney/plugin-sdk`. A fresh install is useful on its
own; bundled plugins ship enabled but hold no privileges a third-party plugin
couldn't request.

See [ROADMAP.md](ROADMAP.md) for what is built and what is planned, and
[CHANGELOG.md](CHANGELOG.md) for what changed. Full documentation lives at
[wickermoney.dev](https://wickermoney.dev).

## Layout

| Path | Purpose |
|---|---|
| `apps/api` | Fastify backend and plugin host |
| `apps/web` | React frontend, Module Federation host |
| `packages/plugin-sdk` | The single contract both sides implement |
| `packages/ui-kit` | Shared components plugins import |
| `plugins/*` | Bundled and optional plugins |

## Getting started

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
| `pnpm test:integration` | API integration tests against a real PostgreSQL (see [Running tests against the same server](#running-tests-against-the-same-server)) |

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

### Forgotten password

A self-hosted instance has no mail server, so there is no reset link to send.
Reset from the machine running the API instead:

```bash
pnpm --filter @wickermoney/api reset-password you@example.com
# or, to have one generated and printed once:
pnpm --filter @wickermoney/api reset-password you@example.com --generate
```

The password is read from stdin rather than taken as an argument, so it does not
land in shell history or the process list. Every outstanding session is revoked,
the same as changing a password from inside the app.

This grants no access the operator did not already have — running it requires
the database credentials in `.env`. What it saves is producing a correct
Argon2id digest with the application's own parameters by hand.

### Using an existing PostgreSQL server

The database is called **`wickermoney`**.

As a superuser, once:

```sql
CREATE ROLE wickermoney LOGIN PASSWORD 'pick-something' CREATEROLE;
CREATE DATABASE wickermoney OWNER wickermoney;
```

`CREATEROLE` is required: migration 005 creates the `wickermoney_app` role. Without
it the migration fails with *"Only roles with the CREATEROLE attribute may
create roles."* Verify before migrating:

```sql
SELECT current_database(), current_user,
       (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create_roles;
```

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

## Running the container image

One image holds the API, the built web app and the bundled plugins. The API serves
the UI itself (`WEB_DIST_DIR`, set to `/app/web` in the image), so there is one
process on one port (8080) and one origin, which the refresh cookie and
same-origin plugin loading depend on.

```bash
# Build it, or pull a released one: ghcr.io/wickermoney/wicker-money:<version>
docker build -f docker/Dockerfile -t wickermoney .

# 1. Migrate, as the database owner. The image does not migrate on start.
docker run --rm --env-file .env wickermoney node dist/db/cli.js up

# 2. Run it.
docker run -d --name wickermoney --env-file .env -p 8080:8080 wickermoney
```

For a full stack with its own PostgreSQL container instead of running
`docker run` by hand, see [`docker/docker-compose.sample.yml`](docker/docker-compose.sample.yml) —
copy it to `docker-compose.yml`, review it top to bottom (role names
especially, per `.env.example`), and `docker compose up -d`.

It takes the same variables as `.env.example`. The image sets `NODE_ENV=production`,
so the API refuses the development credentials, and `localhost` in `DATABASE_URL`
means the container itself, not your machine.

> [!WARNING]
> **Serve Wicker Money over HTTPS. Plain HTTP is for `localhost` and a first smoke test only.**
>
> Wicker Money holds your financial data and your session. Over plain HTTP on a LAN
> address (`http://192.168.x.x:8080`):
>
> - **Credentials and the refresh token cross the network in clear text.** Anyone
>   on the same network segment can read them.
> - **The browser treats the page as an insecure context** and withholds
>   HTTPS-only APIs. `crypto.randomUUID` is the one that has already broken a page
>   (the Categories rule builder, 2026-09-23). Browser code must use `newUuid()`
>   from `apps/web/src/lib`, and an ESLint rule enforces that, but clipboard,
>   `crypto.subtle` and service workers are missing too.
> - **You have to weaken the cookie** (`COOKIE_SECURE=false`), or the browser
>   discards the refresh cookie and signs you out on every reload.
> - The `Cross-Origin-Opener-Policy` and `Origin-Agent-Cluster` console warnings
>   are this same cause. They are harmless and disappear over HTTPS.
>

### Behind an HTTPS reverse proxy (recommended)

Terminate TLS in a reverse proxy (Caddy, Nginx Proxy Manager or Traefik) and
forward to the container's single port, 8080. There is no separate UI port.

- Set `TRUST_PROXY=true`, or every user shares the proxy's address for the
  per-address auth limits (`AUTH_RATE_LIMIT_MAX`).
- Leave `COOKIE_SECURE` unset. It defaults to `true` in production.
- **Do not also publish 8080 to the LAN.** With `TRUST_PROXY=true` the API believes
  `X-Forwarded-For`, so a client that reaches the container directly can spoof its
  address and dodge the rate limits. Put the proxy on the same Docker network, or
  bind the port to loopback (`127.0.0.1:8080:8080`).
- The proxy must pass the original `Host` (Caddy and Nginx Proxy Manager do by
  default; plain Nginx needs `proxy_set_header Host $host`). State-changing auth
  requests are rejected when `Origin` does not match it (`origin_mismatch`).
- Helmet sends `Strict-Transport-Security` with `includeSubDomains`. Once a browser
  has seen it over HTTPS, it refuses plain HTTP for that host and its subdomains
  for a year (Helmet 8's default `max-age`). Serve Wicker Money on its own subdomain (`wickermoney.example.com`), not
  on an apex domain that also hosts HTTP-only services.

```caddyfile
wickermoney.example.com {
    reverse_proxy wickermoney:8080
}
```

### Plain HTTP (local testing only)

Set `COOKIE_SECURE=false`. Expect the limitations in the warning above.

### Common mistakes

- **Setting `PORT` to change the host port.** `PORT` is the port the API listens
  on *inside* the container. Change the host side of the mapping instead
  (`"8180:8080"`), or nothing answers.
- **Publishing 5173.** That is the Vite dev server, which is not in the image.
- **A `curl` healthcheck in compose.** The image is `bookworm-slim` and has no
  `curl`. Omit the healthcheck block; the image's built-in one uses `node`.

The container's health check calls `/healthz`. Use `/readyz` (which also checks the
database) for a load balancer. Both report the running `version` (and `gitSha`,
when the image was built from a tag) -- handy for confirming what actually
redeployed without cross-checking the image tag. `core.app_deployments` keeps
one row per boot with the same information, for after the fact.

### Upgrading

Read the release's entry in [`CHANGELOG.md`](CHANGELOG.md) first, and **back up
the database** (`pg_dump -Fc`) before migrating. Migrations only move forward in
practice: some have no `down` at all (021, in `v0.2.0`, reshapes recurring items
and adds an enum label PostgreSQL cannot remove), so the way back to an older
image is restoring that backup. A release with no migrations, such as `v0.2.1`,
can go back to the previous image as it is. `v0.3.0` has one of each kind: 023
(budget windows) has a `down`, but 024 (recurring occurrences) does not, so
going back to `v0.2.1` also means restoring the backup.

Then pull the new image and migrate before starting it, exactly as on first
install (`node dist/db/cli.js up`). With the compose sample, `docker compose pull`
and `docker compose up -d` do both, because its `migrate` service runs first.

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

### Plugin roles

Each plugin gets a PostgreSQL role, named `<app role>_plugin_<slug>` and granted
exactly what its manifest asks for. Grants are recomputed from the manifests on
every `pnpm migrate`, revoking first, so removing a table from `requiredTables`
actually removes the grant.

Roles are namespaced under `APP_DB_ROLE` for the same reason the app role is:
PostgreSQL roles are cluster-wide, so two Wicker Money databases on one server would
otherwise fight over them. Set `APP_DB_ROLE` the same way for `pnpm migrate` and
for the API.

## Status

**`v0.3.0` — paid / landed matching, budget windows, and the money module.**
Transactions can be matched to the recurring occurrences they paid (suggested,
never automatic), single occurrences can be skipped, moved or re-priced, and
matched items flag late occurrences, so "Until payday" and the forecast stop
double-counting money that already arrived (migration 024). Budgets gain
windows: one amount for one category across a date range (migration 023).
`@wickermoney/plugin-sdk/money` is the one copy of exact decimal-string money
arithmetic that budgets, insights, spending trends and the recurrence module now
share; it throws on more than four decimal places instead of truncating.

**`v0.2.1` — recurring items, Phase B: the forecast.** A Forecast page from a
new bundled plugin, `plugins/forecast`. For one account at a time, it shows a
step chart of the projected balance from recurring items, the first day it
dips below zero or its buffer, and what moves the line. Also: your time zone is
now a setting (Settings, and the browser's zone at sign-up), which fixes
"today" rolling over in the evening west of UTC. No migrations.

**`v0.2.0` — recurring items, Phase A.** A Recurring page for income, bills,
debt payments and transfers, modelled as an item plus per-account legs
(migration 021), and the "Until payday" dashboard widget from a new bundled
plugin, `plugins/upcoming`: safe to spend until the next payday, each checking
account's low point against its buffer, and a shortfall warning that never nets
one account against another. Which accounts count toward safe to spend is a
per-account choice (migration 022), and buffers are editable on the Accounts
page. The date maths is public in `@wickermoney/plugin-sdk/recurrence` so
forecasting can reuse it. Also: transfer `externalId` for duplicate-safe
imports, and a fix for plugins showing calendar dates a day early west of UTC.

**M4 — release readiness and brand identity.** Everything needed to cut the
first public tag, `v0.1.0`: a self-hosting quickstart (`docker/docker-compose.sample.yml`
alongside the plain `docker run` walkthrough above), a published multi-arch
container image and published `@wickermoney/plugin-sdk` / `@wickermoney/ui-kit`
packages (npm's OIDC trusted publishing, no stored token), and first-run
hardening (`REGISTRATION_ENABLED`, `COOKIE_SECURE` defaulting to `true` in
production). Also: the `semimonthly` recurrence frequency; the design-token
rename from the pre-launch `--fio-`/`fio-` prefixes to `--wm-`/`wm-`; the
light/dark/system theme switcher; and the real brand identity — logo,
favicon, and an accent and chart palette derived from the actual logo colors
(the shipped blue and an earlier ported guide's indigo both predated the real
assets and matched neither). Full color/token record in `packages/ui-kit/src/tokens.css`.

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
the authoritative one — the matching client-side guard is developer ergonomics,
since plugin code shares the host's realm. The enforceable second layer, a
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
