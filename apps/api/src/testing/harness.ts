import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { configureTenantContext } from '../db/configureTenantContext.js'
import { createDb, type Db } from '../db/client.js'
import { installTenantContextKey } from '../db/installTenantContextKey.js'
import { migrateToLatest } from '../db/migrate.js'
import { provisionPluginRoles } from '../db/plugin-roles.js'
import { REFRESH_COOKIE_NAME } from '../auth/routes/helpers/REFRESH_COOKIE_NAME.js'
import { BUNDLED_PLUGINS } from '../plugins/bundled.js'

/**
 * @module
 * Integration-test harness. Tests run against a real PostgreSQL instance, never
 * a stub.
 *
 * Row-level security, check constraints, partial unique indexes and numeric
 * precision are the things most worth testing, and none of them exist in an
 * in-memory fake — a passing test against a fake would be worse than no test,
 * because it would imply coverage that isn't there.
 */

/**
 * Name of the application role used by tests (`APP_DB_ROLE`, else
 * `wickermoney_app_test`).
 *
 * Tests use their OWN application role, not the one the dev environment uses.
 * PostgreSQL roles are cluster-wide. When a dev database and a test database
 * live on the same server, a shared role means whichever ran last owns the
 * password, so running the suite would silently invalidate the dev
 * credential. A separate role removes the coupling entirely.
 */
export const TEST_APP_ROLE = process.env['APP_DB_ROLE'] ?? 'wickermoney_app_test'

/** Connection URL for the test database as the application role (`TEST_DATABASE_URL`, else a local default). */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  `postgresql://${TEST_APP_ROLE}:testpw@localhost:5432/wickermoney_test`

/** Connection URL for the test database as its owning role (`TEST_ADMIN_DATABASE_URL`, else a local default). */
export const TEST_ADMIN_DATABASE_URL =
  process.env['TEST_ADMIN_DATABASE_URL'] ?? 'postgresql://postgres@localhost:5432/wickermoney_test'

/** `AUTH_SECRET` the harness runs with; the tenant-context key is derived from it. */
export const TEST_AUTH_SECRET = 'test-secret-that-is-comfortably-long-enough-32'

/** A running application instance wired to the test database. */
export interface Harness {
  /** The built Fastify app; use `app.inject` to make requests. */
  readonly app: FastifyInstance
  /** Database handle connected as the test application role. */
  readonly db: Db
  /** Configuration the app was built with. */
  readonly config: Config
  /** Closes the app and the database pool. */
  close: () => Promise<void>
}

/**
 * Builds the application against the test database and waits until it is ready.
 *
 * Logging is silent unless `LOG_LEVEL` is set in the environment. Callers must
 * call `close()` when done.
 *
 * @param overrides - Configuration variables to set on top of the harness's own,
 *   for a test that needs a differently configured app (for example
 *   `WEB_DIST_DIR`).
 * @returns A {@link Harness}.
 */
export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_SECRET: TEST_AUTH_SECRET,
    AUTH_ACCESS_TTL_SECONDS: '900',
    // Generous so the many registrations across test files never trip the
    // limiter; the limiter itself is tested on a dedicated low-limit app.
    AUTH_RATE_LIMIT_MAX: '100000',
    AUTH_EMAIL_RATE_LIMIT_MAX: '100000',
    // Quiet by default, but `LOG_LEVEL=error pnpm test` surfaces the real cause
    // of a 500 when a test only tells you the status code.
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'silent',
    ...overrides,
  } as NodeJS.ProcessEnv)

  configureTenantContext(config.AUTH_SECRET)
  const db = createDb(config.DATABASE_URL)
  const app = buildApp({ db, config })
  await app.ready()

  return {
    app,
    db,
    config,
    close: async () => {
      await app.close()
      await db.destroy()
    },
  }
}

/**
 * Applies migrations to the test database as its owning role, enables login for
 * the test application role, installs the tenant-context key derived from
 * {@link TEST_AUTH_SECRET}, and provisions the per-plugin roles. Called once
 * before the suite.
 *
 * The admin URL is `TEST_ADMIN_DATABASE_URL` (default: `postgres` on the local
 * test database) and must not be a superuser.
 *
 * @throws {Error} If the admin role is a superuser, or any step fails.
 */
export async function migrateTestDatabase(): Promise<void> {
  const adminUrl = TEST_ADMIN_DATABASE_URL
  const admin = createDb(adminUrl)

  await assertOwnerIsNotSuperuser(admin, adminUrl)

  // The app-role migration reads APP_DB_ROLE, so the role it creates is the test one.
  process.env['APP_DB_ROLE'] = TEST_APP_ROLE
  await migrateToLatest(admin)
  // The signed tenant context is verified against a key derived from the
  // secret, so a migrated test database is not usable until it is installed.
  configureTenantContext(TEST_AUTH_SECRET)
  await installTenantContextKey(admin)

  // Credentials and database name come from the URL rather than literals, so
  // there is exactly one place to change when pointing at another server.
  const url = new URL(TEST_DATABASE_URL)
  const password = decodeURIComponent(url.password)
  const database = url.pathname.slice(1)
  const role = sql.raw(TEST_APP_ROLE)

  await sql`ALTER ROLE ${role} LOGIN PASSWORD ${sql.lit(password)}`.execute(admin)
  await sql`GRANT CONNECT ON DATABASE ${sql.id(database)} TO ${role}`.execute(admin)

  // Plugin roles are part of a working database, not an extra. The migrate
  // command provisions them from the manifests; the suite has to do the same, or every
  // plugin endpoint fails on SET ROLE and the tests that prove a plugin cannot
  // exceed its grants would pass for the wrong reason — there would be no role
  // to exceed them with.
  await provisionPluginRoles(admin, BUNDLED_PLUGINS)

  await admin.destroy()
}

/**
 * Refuses to run the suite against a superuser-owned database.
 *
 * The migration role owns the tables and therefore owns the SECURITY DEFINER
 * pre-authentication functions, which execute with its privileges. If it is a
 * superuser, those functions bypass row-level security unconditionally — so
 * registration and login pass here and fail on a real deployment, where the
 * owner is an ordinary role (surfacing as `new row violates row-level security
 * policy for table "users"`).
 *
 * A real deployment's owner should never be a superuser, so matching that here
 * costs nothing and removes the entire class of false pass.
 *
 * @param admin - Connection as the migration owner; destroyed if this throws.
 * @param url - The admin connection URL, echoed (password masked) in the error.
 * @throws {Error} If the connected role is a superuser.
 */
async function assertOwnerIsNotSuperuser(admin: Db, url: string): Promise<void> {
  const { rows } = await sql<{ role: string; is_superuser: boolean }>`
    SELECT current_user::text AS role, rolsuper AS is_superuser
    FROM pg_catalog.pg_roles WHERE rolname = current_user
  `.execute(admin)

  if (rows[0]?.is_superuser !== true) return

  const role = rows[0].role
  await admin.destroy()
  throw new Error(
    `TEST_ADMIN_DATABASE_URL connects as '${role}', which is a SUPERUSER.\n\n` +
      `The suite would then exercise the SECURITY DEFINER functions with RLS\n` +
      `bypassed, so isolation tests would pass without proving anything and\n` +
      `auth would break on any real deployment.\n\n` +
      `Create an ordinary owner instead:\n\n` +
      `    CREATE ROLE wickermoney_test_owner LOGIN PASSWORD '...' CREATEROLE;\n` +
      `    CREATE DATABASE wickermoney_test OWNER wickermoney_test_owner;\n\n` +
      `Current value: ${url.replace(/:[^:@/]*@/, ':***@')}`,
  )
}

/** A user registered through the API, with credentials for authenticated requests. */
export interface TestUser {
  /** User id. */
  readonly id: string
  /** Unique generated email address. */
  readonly email: string
  /** Bearer access token. */
  readonly accessToken: string
  /** Refresh token, as carried by the `wickermoney_refresh` cookie. */
  readonly refreshToken: string
}

/**
 * Registers a fresh user with a unique email through the real registration
 * endpoint.
 *
 * @param h - The running harness.
 * @returns The new user's id, email and tokens.
 * @throws {Error} If registration does not return 201.
 */
export async function createUser(h: Harness): Promise<TestUser> {
  const email = `user-${randomUUID()}@example.com`
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: 'correct-horse-battery-staple' },
  })
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`)
  const body = res.json() as { accessToken: string; user: { id: string; email: string } }
  const refresh = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)
  if (refresh === undefined) throw new Error('register did not set the refresh cookie')
  return {
    id: body.user.id,
    email: body.user.email,
    accessToken: body.accessToken,
    refreshToken: refresh.value,
  }
}

/**
 * Builds the request headers that authenticate as a test user.
 *
 * @param user - A user from {@link createUser}.
 * @returns Headers containing `authorization: Bearer <accessToken>`, for `app.inject`.
 */
export function auth(user: TestUser): Record<string, string> {
  return { authorization: `Bearer ${user.accessToken}` }
}
