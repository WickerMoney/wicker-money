import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { asPlugin, asSystem, asUser } from './client.js'
import { pluginRoleName } from './plugin-roles.js'

const PLUGIN = 'wickermoney.import-csv'

let h: Harness
let user: TestUser

beforeAll(async () => {
  // A pool that cancels any statement over one second, so the tests below can
  // tell the default limit from a transaction's own.
  h = await createHarness({ DB_STATEMENT_TIMEOUT: '1000', DB_LONG_STATEMENT_TIMEOUT: '10000', DB_POOL_MAX: '3' })
  user = await createUser(h)
})
afterAll(async () => { await h.close() })

const limit = () => sql<{ t: string }>`SELECT current_setting('statement_timeout') AS t`
const sleep = (seconds: number) => sql`SELECT pg_sleep(${seconds})`

describe('statement limit', () => {
  it('uses the configured default for an ordinary transaction', async () => {
    const seen = await asUser(h.db, user.id, async (trx) => (await limit().execute(trx)).rows[0]?.t)
    expect(seen).toBe('1s')
  })

  it('cancels a statement over the default limit', async () => {
    await expect(asUser(h.db, user.id, (trx) => sleep(1.6).execute(trx))).rejects.toMatchObject({ code: '57014' })
  })

  it('lets a transaction opt into a longer one, for asUser, asSystem and asPlugin', async () => {
    const options = { statementTimeoutMillis: 10_000 }
    expect(await asUser(h.db, user.id, async (trx) => (await limit().execute(trx)).rows[0]?.t, options)).toBe('10s')
    expect(await asSystem(h.db, async (trx) => (await limit().execute(trx)).rows[0]?.t, options)).toBe('10s')
    expect(
      await asPlugin(h.db, pluginRoleName(PLUGIN), user.id, async (trx) => (await limit().execute(trx)).rows[0]?.t, options),
    ).toBe('10s')
  })

  it('lets a statement run past the default limit under the longer one', async () => {
    await expect(
      asUser(h.db, user.id, (trx) => sleep(1.6).execute(trx), { statementTimeoutMillis: 10_000 }),
    ).resolves.toBeDefined()
  })

  it('does not leak the longer limit to the next use of the pooled connection', async () => {
    // Three connections at most, so repeated transactions reuse them.
    for (let i = 0; i < 6; i++) {
      await asUser(h.db, user.id, (trx) => limit().execute(trx), { statementTimeoutMillis: 10_000 })
      const seen = await asUser(h.db, user.id, async (trx) => (await limit().execute(trx)).rows[0]?.t)
      expect(seen).toBe('1s')
    }
  })

  it('caps the pool at DB_POOL_MAX connections', async () => {
    let inside = 0
    let mostInside = 0
    const hold = () =>
      asUser(h.db, user.id, async (trx) => {
        inside++
        mostInside = Math.max(mostInside, inside)
        await sleep(0.3).execute(trx)
        inside--
      })
    await Promise.all(Array.from({ length: 8 }, hold))
    // Eight transactions asked at once; the pool of three let three run.
    expect(mostInside).toBe(3)
  })
})
