import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asPlugin, asUser } from '../db/client.js'
import { pluginRoleName } from '../db/plugin-roles.js'
import type { Trx } from '../db/Trx.js'
import { createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'
import { PluginSqlRejectedError } from './PluginSqlRejectedError.js'
import { queryRunner } from './queryRunner.js'

const ROLE = pluginRoleName('wickermoney.budgets')

let h: Harness
let user: TestUser

beforeAll(async () => {
  h = await createHarness()
  user = await createUser(h)
})
afterAll(async () => { await h.close() })

/** Runs statement text through a runner over no connection; a refusal happens before any query is sent. */
function refused(text: string): Promise<unknown> {
  const q = queryRunner(undefined as unknown as Trx)
  return q(Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray)
}

describe('statements the plugin runner refuses', () => {
  it.each([
    'RESET ROLE',
    'reset   role',
    'Reset\n\tRoLe',
    'SET ROLE postgres',
    'set role "wickermoney_app_test"',
    "SET LOCAL app.user_id = 'x'",
    'set local statement_timeout = 0',
    "SET app.user_id = 'someone-else'",
    "set  \"app.user_id\" to 'x'",
    'SET SESSION AUTHORIZATION postgres',
    'RESET SESSION AUTHORIZATION',
    'RESET ALL',
    'DISCARD ALL',
    "SELECT set_config('app.user_id', 'someone-else', true)",
    "SELECT SET_CONFIG ( 'app.user_id', 'x', false )",
    "SELECT pg_catalog.set_config('role', 'postgres', true)",
    'RESET/**/ROLE',
    'RESET -- comment\n ROLE',
    "SELECT '--'; RESET ROLE",
    "SELECT '/*'; RESET ROLE; SELECT '*/'",
  ])('rejects %j', async (text) => {
    await expect(refused(text)).rejects.toBeInstanceOf(PluginSqlRejectedError)
    await expect(refused(text)).rejects.toThrow(/Plugin query refused/)
  })

})

describe('statements the plugin runner allows', () => {
  it('runs ordinary queries as the plugin role and the calling user', async () => {
    const seen = await asPlugin(h.db, ROLE, user.id, async (trx) => {
      const q = queryRunner(trx)
      const [who] = await q<{ role: string; uid: string }>`
        SELECT current_user::text AS role, current_setting('app.user_id') AS uid
      `
      const echoed = await q<{ n: number }>`SELECT ${7}::int AS n`
      const rows = await q<{ id: string }>`SELECT id FROM core.categories LIMIT 1`
      return { who, echoed, rows }
    })
    expect(seen.who).toEqual({ role: ROLE, uid: user.id })
    expect(seen.echoed).toEqual([{ n: 7 }])
    expect(Array.isArray(seen.rows)).toBe(true)
  })

  it('checks the literal text of a template, not its bound values', async () => {
    // A value is sent as a parameter and can never be parsed as SQL, so one
    // that merely mentions a forbidden word is fine.
    await asUser(h.db, user.id, async (trx) => {
      await expect(queryRunner(trx)<{ v: string }>`SELECT ${'reset role'}::text AS v`).resolves.toEqual([
        { v: 'reset role' },
      ])
    })
  })

  it('does not mistake column assignments and identifiers for session commands', async () => {
    await asUser(h.db, user.id, async (trx) => {
      const q = queryRunner(trx)
      await expect(q`SELECT 1 AS reset_all, 2 AS settings, 3 AS local_x`).resolves.toEqual([
        { reset_all: 1, settings: 2, local_x: 3 },
      ])
      await expect(
        q`UPDATE core.users SET timezone = timezone WHERE id = ${user.id}`,
      ).resolves.toEqual([])
    })
  })

  it('leaves the role and user binding intact after a refused statement', async () => {
    const after = await asPlugin(h.db, ROLE, user.id, async (trx) => {
      const q = queryRunner(trx)
      await expect(q`RESET ROLE`).rejects.toBeInstanceOf(PluginSqlRejectedError)
      await expect(q`SELECT set_config('app.user_id', ${'someone-else'}, true)`)
        .rejects.toBeInstanceOf(PluginSqlRejectedError)
      const [row] = await q<{ role: string; uid: string }>`
        SELECT current_user::text AS role, current_setting('app.user_id') AS uid
      `
      return row
    })
    expect(after).toEqual({ role: ROLE, uid: user.id })
  })
})
