# WickerMoney

Self-hostable personal finance, rebuilt as a thin core plus installable plugins.

The core owns identity, money movement and the app shell. Everything that
*interprets* money — budgets, forecasting, net worth, FIRE, importers — is a
plugin built against `@wickermoney/plugin-sdk`. A fresh install is useful on its
own; bundled plugins ship enabled but hold no privileges a third-party plugin
couldn't request.

See `../BUILD_PLAN.md` for the architecture and milestones, `../DISCOVERY.md`
for what the previous C# implementation did, and `../OPEN_QUESTIONS.md` for the
design decisions and their reasoning.

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
outright (see `OPEN_QUESTIONS.md` Q15 and Q16).

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
problem on the 10th, and the *Watch list* dashboard widget ranks by that rather
than by amount.

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
# Build it, or pull a released one: git.jreed.me/wickermoney/wickermoney:<version>
docker build -f docker/Dockerfile -t wickermoney .

# 1. Migrate, as the database owner. The image does not migrate on start.
docker run --rm --env-file .env wickermoney node dist/db/cli.js up

# 2. Run it.
docker run -d --name wickermoney --env-file .env -p 8080:8080 wickermoney
```

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
> Decision record: `OPEN_QUESTIONS.md` Q39.

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

## Releasing

Push a version tag; `.gitea/workflows/release.yml` does the rest.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

It re-runs lint, typecheck, build and the unit tests on the tagged commit, then:

| Output | Where |
|---|---|
| Every non-private package (`plugin-sdk`, `ui-kit`, and the four `plugins/*`) at the tag's version | Gitea npm registry, `git.jreed.me/api/packages/wickermoney/npm/` |
| Multi-arch image (amd64 + arm64), `:<version>` and `:latest` | `git.jreed.me/wickermoney/wickermoney` |
| A release with the commit subjects since the previous tag | Gitea releases |

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

The workflow needs the repository secrets `REGISTRY_USER` and `REGISTRY_TOKEN`,
the same ones the other Wicker Money repositories use for both the npm and container
registries. To consume the
packages, map the scope in your `.npmrc`:

```ini
@wickermoney:registry=https://git.jreed.me/api/packages/wickermoney/npm/
```

Pull requests also build the image (without pushing it), so a broken Dockerfile
fails before a tag does.

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
database role per plugin, arrives at M4.

**M1 — auth and ledger.** Users, sessions, accounts, categories, category
rules, transactions and splits, all under row-level security. Account balances
are derived from the ledger, never stored. Money is `numeric(19,4)` in Postgres
and `string` in TypeScript — never `number`.

204 tests, including an isolation suite that proves one user cannot read, fetch
or modify another's rows, and a suite that proves a plugin cannot reach a table
its manifest never asked for.
