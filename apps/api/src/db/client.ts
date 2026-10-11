import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely'
import pg from 'pg'
import { bindTenantContext } from './bindTenantContext.js'
import type { Database } from './models/index.js'

// numeric(19,4) arrives as a string by default in node-postgres and must stay
// that way. Parsing it to a float would silently lose precision on large
// values — exactly the bug an exact numeric column type exists to prevent.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v)
// DATE likewise: we want '2026-09-15', not a Date shifted by the host timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

/** Kysely handle over the application schema. */
export type Db = Kysely<Database>

/**
 * Creates a Kysely instance backed by a `pg` connection pool (10 connections unless `options.max` says otherwise).
 *
 * The connection's role determines what row-level security applies; see
 * {@link asUser}, {@link asSystem} and {@link asPlugin} for scoped access.
 *
 * @param connectionString - PostgreSQL connection URL.
 * @returns A new {@link Db}; the caller owns it and should call `destroy()`.
 */
export function createDb(connectionString: string, options: PoolOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    // Without a connect timeout a saturated pool queues requests forever.
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    statement_timeout: options.statementTimeoutMillis ?? 30_000,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMillis ?? 60_000,
  })
  // An idle client that errors (for example after a database restart) is
  // emitted on the pool. With no listener Node treats it as an uncaught
  // exception and the process exits.
  pool.on('error', (error) => {
    console.error('Unexpected error on an idle database client:', error.message)
  })
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}

/** Tunables for the connection pool created by {@link createDb}. */
export interface PoolOptions {
  /** Maximum connections in the pool. Defaults to 10. */
  readonly max?: number
  /** How long a request waits for a free connection before failing. Defaults to 5000. */
  readonly connectionTimeoutMillis?: number
  /** Server-side cap on a single statement. Defaults to 30000. */
  readonly statementTimeoutMillis?: number
  /** Server-side cap on a transaction sitting idle between statements. Defaults to 60000. */
  readonly idleInTransactionTimeoutMillis?: number
}

/** Optional transaction characteristics for {@link asUser} and {@link asSystem}. */
export interface TransactionOptions {
  /** Isolation level. Defaults to PostgreSQL's `read committed`. */
  readonly isolation?: 'read committed' | 'repeatable read' | 'serializable'
  /** Open the transaction read-only, so any write fails. */
  readonly readOnly?: boolean
}

/** Starts a Kysely transaction builder configured from `options`. */
function beginTransaction(db: Db, options: TransactionOptions | undefined) {
  let builder = db.transaction()
  if (options?.isolation !== undefined) builder = builder.setIsolationLevel(options.isolation)
  if (options?.readOnly === true) builder = builder.setAccessMode('read only')
  return builder
}

/**
 * Runs `fn` inside a transaction with `app.user_id` bound, so every row-level
 * security policy resolves against this user.
 *
 * Two properties matter:
 *  - `SET LOCAL` is transaction-scoped, so the value cannot leak to the next
 *    checkout of a pooled connection.
 *  - `set_config` is parameterised, so the id can never be interpolated into
 *    SQL text.
 *
 * The id is bound together with its HMAC signature (see
 * {@link bindTenantContext}); `core.current_user_id()` returns NULL for an
 * unsigned or wrongly signed id, so SQL that overwrites the settings later in
 * the transaction cannot switch tenant.
 *
 * Every authenticated request goes through here. Nothing else sets the GUC.
 *
 * @param db - Database handle.
 * @param userId - Id bound to `app.user_id` for the duration of the transaction.
 * @param fn - Work to run in the transaction; the transaction commits when it
 *   resolves and rolls back when it throws.
 * @param options - Optional isolation level and access mode.
 * @returns Whatever `fn` returns.
 * @throws {Error} If the tenant context has not been configured.
 */
export async function asUser<T>(
  db: Db,
  userId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return beginTransaction(db, options).execute(async (trx) => {
    await bindTenantContext(trx, userId)
    return fn(trx)
  })
}

/**
 * Runs `fn` with no user bound. RLS still applies — `core.current_user_id()`
 * returns NULL, which matches no row — so this is only useful for operations
 * on tables without RLS, or for deliberate pre-authentication lookups that
 * take an explicit escape hatch.
 *
 * @param db - Database handle.
 * @param fn - Work to run in the transaction.
 * @param options - Optional isolation level and access mode.
 * @returns Whatever `fn` returns.
 */
export async function asSystem<T>(
  db: Db,
  fn: (trx: Transaction<Database>) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return beginTransaction(db, options).execute(fn)
}

/** A plain lowercase PostgreSQL identifier, the only shape a role name may take here. */
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Refuses a role name that is not a plain lowercase identifier.
 *
 * @param role - Candidate role name.
 * @throws {Error} If `role` is not a plain lowercase identifier.
 */
function assertRoleName(role: string): void {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Refusing to SET ROLE to a non-identifier: ${role}`)
  }
}

/**
 * Switches an open transaction to `role` for the rest of that transaction
 * (`SET LOCAL ROLE`), after checking the name is a plain identifier.
 *
 * The one place a role name reaches SQL at request time. `SET ROLE` takes an
 * identifier, which cannot be sent as a bound parameter, so the name is checked
 * and then quoted with `sql.id` rather than spliced in as raw text. Callers
 * still pass a role derived from a plugin id, never request input; the check
 * is the backstop, not the plan.
 *
 * @param trx - The transaction to switch.
 * @param role - Role to assume (lowercase identifier, max 63 chars).
 * @throws {Error} If `role` is not a plain lowercase identifier.
 */
export async function setLocalRole(trx: Transaction<Database>, role: string): Promise<void> {
  assertRoleName(role)
  await sql`SET LOCAL ROLE ${sql.id(role)}`.execute(trx)
}

/**
 * Runs `fn` as a plugin: the plugin's database role, bound to one user.
 *
 * This is the enforceable half of `requiredTables`. Inside the transaction the
 * session's identity is the plugin's role, so a query against a table the
 * manifest never asked for fails with `permission denied` from PostgreSQL —
 * not because the application decided not to issue it, but because the role
 * cannot. An application-level manifest check can give a friendlier message
 * first; this is what still holds when that check is wrong.
 *
 * `SET LOCAL ROLE` rather than a connection pool per plugin: role membership is
 * granted to the application role at provisioning time, and LOCAL means the
 * switch is unwound with the transaction, so a pooled connection can never be
 * handed to the next request still wearing a plugin's identity.
 *
 * Row-level security is unaffected by the switch — policies key on the signed
 * tenant context, not on `current_user` — so the plugin sees exactly the rows
 * its user would, within the tables its manifest allows. Because the context
 * is signed, SQL that runs `RESET ROLE` and rewrites `app.user_id` still reads
 * no other tenant's rows; it does regain the application role's table
 * privileges for its own tenant.
 *
 * The role name is checked against a plain-identifier pattern before it is
 * interpolated into `SET LOCAL ROLE`; it must come from a derived plugin role
 * name, never from request input.
 *
 * @param db - Database handle.
 * @param role - Plugin database role to assume (lowercase identifier, max 63 chars).
 * @param userId - Id bound to `app.user_id` for the duration of the transaction.
 * @param fn - Work to run in the transaction.
 * @returns Whatever `fn` returns.
 * @throws {Error} If `role` is not a plain lowercase identifier, or the tenant
 *   context has not been configured.
 */
export async function asPlugin<T>(
  db: Db,
  role: string,
  userId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  // Fail before a transaction is opened, not inside one.
  assertRoleName(role)
  return db.transaction().execute(async (trx) => {
    // Order matters: bind the context first. After SET ROLE the session may no
    // longer hold the privileges set_config needs on some configurations, and
    // a failure there would leave the transaction running as the plugin with
    // no user bound — which RLS would treat as "no rows" rather than an error.
    await bindTenantContext(trx, userId)
    await setLocalRole(trx, role)
    return fn(trx)
  })
}
