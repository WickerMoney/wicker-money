import { randomInt } from 'node:crypto'
import pg from 'pg'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../db/client.js'
import {
  TEST_ADMIN_DATABASE_URL, auth, createHarness, createUser, type Harness, type TestUser,
} from '../testing/harness.js'
import { rowsOwnedBy, setRole } from '../testing/userData.js'

/**
 * Erasing while another request is in flight, against real PostgreSQL.
 *
 * DEVELOPMENT.md ("Erasing data") says an erase does not stop requests already
 * in flight. These tests hold one write open at a chosen point (a trigger that
 * waits for an advisory lock the test holds), run the erase, then let the write
 * go, so what happens is the same on every run and nothing depends on timing.
 *
 * Two different races are covered, because they end differently:
 *
 * - **Open at the erase**: the write has inserted its row but not committed
 *   when the erase starts (the "paused after the insert" cases).
 * - **Authenticated before the erase, writes after it**: the request passed its
 *   session check, then the erase committed, then the write ran (the "paused
 *   before the insert" cases).
 *
 * The instance erase is checked for the same two races at the end. It empties
 * the whole shared test database, as `eraseInstance.integration.test.ts` does.
 */

const PASSWORD = 'correct-horse-battery-staple'
const ERASE_MY_DATA = '/api/v1/settings/erase-my-data'
const ERASE_INSTANCE = '/api/v1/settings/erase-instance'

let h: Harness
let admin: Db
let holder: pg.Client

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  holder = new pg.Client({ connectionString: TEST_ADMIN_DATABASE_URL })
  await holder.connect()
  // A run that was killed part-way can leave its trigger behind; it would pause every later insert.
  await sql`DROP FUNCTION IF EXISTS core.zz_pause() CASCADE`.execute(admin)
  await sql`
    CREATE OR REPLACE FUNCTION core.zz_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(TG_ARGV[0]::bigint);
      RETURN NEW;
    END $$
  `.execute(admin)
})
afterAll(async () => {
  await holder.end()
  await sql`DROP FUNCTION IF EXISTS core.zz_pause() CASCADE`.execute(admin)
  await admin.destroy()
  await h.close()
})

/** A write that can be held open, and released, from the test. */
interface HeldWrite {
  /** The HTTP response, once the write is released and finishes. */
  readonly response: Promise<{ statusCode: number }>
  /** Lets the write carry on. */
  release: () => Promise<void>
  /** Resolves once the write is waiting at its pause point. */
  paused: Promise<number>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `check` returns a value, or fails after five seconds. */
async function until<T>(what: string, check: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const found = await check()
    if (found !== undefined) return found
    await sleep(50)
  }
  throw new Error(`Gave up waiting for ${what}.`)
}

/** The backend id of the one connection waiting on advisory lock `key`. */
async function backendWaitingOn(key: number): Promise<number> {
  return until(`a write waiting on lock ${key}`, async () => {
    const { rows } = await sql<{ pid: number }>`
      SELECT l.pid::int AS pid FROM pg_locks l
      WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objid = ${key}::oid
    `.execute(admin)
    return rows[0]?.pid
  })
}

/** Resolves once some backend is blocked by `pid`: the erase, queued behind the open write. */
async function waitUntilBlockedBy(pid: number): Promise<void> {
  await until(`a statement blocked by backend ${pid}`, async () => {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
    `.execute(admin)
    return (rows[0]?.n ?? 0) > 0 ? true : undefined
  })
}

/**
 * Starts `request` with a trigger on `table` that makes the insert of the row
 * marked `marker` wait for an advisory lock the test holds.
 *
 * @param table - `core.accounts` or `core.transactions`.
 * @param when - `BEFORE` the row goes in, or `AFTER` (row inserted, its foreign keys checked, nothing committed).
 * @param markerColumn - The column the request writes `marker` to.
 * @param marker - A value only this request writes.
 * @param request - Sends the HTTP request.
 */
async function holdWrite(
  table: 'core.accounts' | 'core.transactions', when: 'BEFORE' | 'AFTER', markerColumn: 'name' | 'merchant', marker: string,
  request: () => Promise<{ statusCode: number }>,
): Promise<HeldWrite & { drop: () => Promise<void> }> {
  const key = randomInt(1, 2_000_000_000)
  await holder.query('SELECT pg_advisory_lock($1)', [key])
  await sql`
    CREATE TRIGGER zz_pause ${sql.raw(when)} INSERT ON ${sql.table(table)}
    FOR EACH ROW WHEN (NEW.${sql.id(markerColumn)} = ${sql.lit(marker)})
    EXECUTE FUNCTION core.zz_pause(${sql.lit(String(key))})
  `.execute(admin)
  const response = request()
  response.catch(() => undefined)
  const paused = backendWaitingOn(key)
  return {
    response,
    paused,
    release: async () => { await holder.query('SELECT pg_advisory_unlock($1)', [key]) },
    drop: async () => {
      await holder.query('SELECT pg_advisory_unlock_all()')
      await sql`DROP TRIGGER IF EXISTS zz_pause ON ${sql.table(table)}`.execute(admin)
    },
  }
}

const createAccount = (user: TestUser, name: string) => () =>
  h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(user),
    payload: { name, accountType: 'checking', initialBalance: '0.00' },
  })

const createTransaction = (user: TestUser, accountId: string, merchant: string) => () =>
  h.app.inject({
    method: 'POST', url: '/api/v1/transactions', headers: auth(user),
    payload: { accountId, amount: '-5.00', merchant, transactionDate: '2020-01-15' },
  })

const eraseMyData = (user: TestUser) =>
  h.app.inject({
    method: 'POST', url: ERASE_MY_DATA, headers: auth(user),
    payload: { password: PASSWORD, confirmation: 'erase my data' },
  })

const me = (user: TestUser) => h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(user) })

/** Rows the user has in the tables a write in these tests touches. */
async function ledgerRows(user: TestUser): Promise<{ accounts: number; transactions: number }> {
  const counts = await rowsOwnedBy(h.db, user.id)
  return { accounts: counts['core.accounts'] ?? 0, transactions: counts['core.transactions'] ?? 0 }
}

async function userWithAccount(): Promise<{ user: TestUser; accountId: string }> {
  const user = await createUser(h)
  const res = await createAccount(user, 'first')()
  expect(res.statusCode).toBe(201)
  return { user, accountId: res.json<{ id: string }>().id }
}

describe('erase my data with a write open at the moment of the erase', () => {
  it('does not wait for an open insert of a row with no parent: the row is committed after the erase and survives', async () => {
    const user = await createUser(h)
    const write = await holdWrite('core.accounts', 'AFTER', 'name', 'open-account', createAccount(user, 'open-account'))
    try {
      await write.paused
      // Not committed yet: the erase cannot see the row, and nothing it does conflicts with the open insert.
      expect(await ledgerRows(user)).toEqual({ accounts: 0, transactions: 0 })
      expect((await eraseMyData(user)).statusCode).toBe(204)
      expect((await me(user)).statusCode).toBe(401)

      await write.release()
      expect((await write.response).statusCode).toBe(201)
    } finally {
      await write.drop()
    }
    // A row for a user who was signed out before it was committed.
    expect(await ledgerRows(user)).toEqual({ accounts: 1, transactions: 0 })
  })

  it('fails, and deletes nothing, when the open insert points at an account the erase wants to delete', async () => {
    const { user, accountId } = await userWithAccount()
    const write = await holdWrite('core.transactions', 'AFTER', 'merchant', 'open-payment', createTransaction(user, accountId, 'open-payment'))
    try {
      const writer = await write.paused
      const erasing = eraseMyData(user)
      erasing.catch(() => undefined)
      // The erase gets as far as deleting the account, which the open insert holds a lock on.
      await waitUntilBlockedBy(writer)

      await write.release()
      expect((await write.response).statusCode).toBe(201)
      // The account cannot go while the new transaction points at it (ON DELETE RESTRICT), so the erase rolls back.
      expect((await erasing).statusCode).toBe(500)
    } finally {
      await write.drop()
    }
    expect(await ledgerRows(user)).toEqual({ accounts: 1, transactions: 1 })
    expect((await me(user)).statusCode).toBe(200)
  })
})

describe('erase my data, then a request that was already authenticated writes', () => {
  it('lets the write land after the erase: the request passed its session check first', async () => {
    const user = await createUser(h)
    const write = await holdWrite('core.accounts', 'BEFORE', 'name', 'late-account', createAccount(user, 'late-account'))
    try {
      await write.paused
      // The request has authenticated and is inside its own transaction. Now the erase runs to completion.
      expect((await eraseMyData(user)).statusCode).toBe(204)
      expect((await me(user)).statusCode).toBe(401)
      expect(await ledgerRows(user)).toEqual({ accounts: 0, transactions: 0 })

      await write.release()
      expect((await write.response).statusCode).toBe(201)
    } finally {
      await write.drop()
    }
    // The documented limit: a row for a user who has just been signed out.
    expect(await ledgerRows(user)).toEqual({ accounts: 1, transactions: 0 })
    expect((await me(user)).statusCode).toBe(401)

    // Nothing is lost for good: the next erase removes it.
    const again = await h.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: PASSWORD } })
    expect(again.statusCode).toBe(200)
    const fresh: TestUser = { ...user, accessToken: again.json<{ accessToken: string }>().accessToken }
    expect((await eraseMyData(fresh)).statusCode).toBe(204)
    expect(await ledgerRows(user)).toEqual({ accounts: 0, transactions: 0 })
  })

  it('cannot add a row that points at an account the erase removed: the foreign key refuses it', async () => {
    const { user, accountId } = await userWithAccount()
    const write = await holdWrite('core.transactions', 'BEFORE', 'merchant', 'late-payment', createTransaction(user, accountId, 'late-payment'))
    try {
      await write.paused
      expect((await eraseMyData(user)).statusCode).toBe(204)
      await write.release()
      expect((await write.response).statusCode).toBeGreaterThanOrEqual(400)
    } finally {
      await write.drop()
    }
    expect(await ledgerRows(user)).toEqual({ accounts: 0, transactions: 0 })
  })
})

describe('erase this instance with a write in flight', () => {
  /** The instance erase empties the shared database, so each case builds its own owner and runs last. */
  async function owner(): Promise<TestUser> {
    const user = await createUser(h)
    await setRole(admin, user.id, 'owner')
    return user
  }

  const eraseInstance = (user: TestUser) =>
    h.app.inject({
      method: 'POST', url: ERASE_INSTANCE, headers: auth(user),
      payload: { password: PASSWORD, confirmation: 'erase this instance', acknowledgeActiveSessions: true },
    })

  const accountsInDatabase = async () =>
    (await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.accounts`.execute(admin)).rows[0]?.n ?? 0

  it('waits for an open insert, then empties the table including that row', async () => {
    const user = await owner()
    const write = await holdWrite('core.accounts', 'AFTER', 'name', 'open-account', createAccount(user, 'open-account'))
    try {
      const writer = await write.paused
      const erasing = eraseInstance(user)
      erasing.catch(() => undefined)
      await waitUntilBlockedBy(writer)

      await write.release()
      expect((await write.response).statusCode).toBe(201)
      expect((await erasing).statusCode).toBe(204)
    } finally {
      await write.drop()
    }
    expect(await accountsInDatabase()).toBe(0)
  })

  it('leaves nothing for a write that was authenticated before the erase: the account row it needs is gone (foreign key)', async () => {
    const user = await owner()
    expect((await eraseInstance(user)).statusCode).toBe(204)
    // What a request that passed its session check just before the erase would now run.
    await expect(asUser(h.db, user.id, (trx) =>
      sql`INSERT INTO core.accounts (user_id, name, account_type, initial_balance) VALUES (${user.id}::uuid, 'late', 'checking', 0)`.execute(trx),
    )).rejects.toMatchObject({ code: '23503' })
    expect(await accountsInDatabase()).toBe(0)
  })
})
