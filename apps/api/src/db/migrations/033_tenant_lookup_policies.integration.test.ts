import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../client.js'
import { createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { down, up } from './033_tenant_lookup_policies.js'

/**
 * Migration 033: a policy written with the bare `core.current_user_id()` is
 * rewritten to the subquery form, whichever migration created it.
 *
 * The drift is made by hand (`ALTER POLICY` back to the bare call), because the
 * migrated test database no longer has any. Every case that changes the catalog
 * restores it, or runs inside a transaction that is rolled back.
 */

let h: Harness
let admin: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const BARE = 'user_id = core.current_user_id()'

/** `[qual, with_check]` of one policy, as PostgreSQL prints them. */
async function printed(db: Executor, table: string, policy: string): Promise<[string | null, string | null]> {
  const { rows } = await sql<{ qual: string | null; with_check: string | null }>`
    SELECT qual, with_check FROM pg_policies
    WHERE schemaname || '.' || tablename = ${table} AND policyname = ${policy}
  `.execute(db)
  const row = rows[0]
  if (row === undefined) throw new Error(`no policy ${policy} on ${table}`)
  return [row.qual, row.with_check]
}

/** Is the call in this printed expression made through a scalar subquery? */
const isWrapped = (expr: string | null): boolean => /\(\s*SELECT\s+core\.current_user_id\(\)/.test(expr ?? '')

/** Is there a call in this printed expression that is not? */
const isBare = (expr: string | null): boolean =>
  (expr ?? '').replace(/\(\s*SELECT\s+(core\.)?current_user_id\(\)(\s+AS\s+current_user_id)?\s*\)/g, '').includes('current_user_id()')

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('migration 033', () => {
  it('leaves the account lines policy in the subquery form after a plain migrate', async () => {
    const [qual, check] = await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')
    expect(isWrapped(qual) && !isBare(qual)).toBe(true)
    expect(isWrapped(check) && !isBare(check)).toBe(true)
  })

  it('rewrites a policy that went back to the bare call, and only once', async () => {
    await sql`
      ALTER POLICY account_lines_isolation ON plugin_budgets.account_lines
        USING (${sql.raw(BARE)}) WITH CHECK (${sql.raw(BARE)})
    `.execute(admin)
    try {
      const [qual] = await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')
      expect(isBare(qual)).toBe(true)

      await up(admin)
      const once = await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')
      expect(isBare(once[0]) || isBare(once[1])).toBe(false)
      expect(isWrapped(once[0]) && isWrapped(once[1])).toBe(true)

      await up(admin)
      expect(await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')).toEqual(once)
    } finally {
      await up(admin)
    }
  })

  it('makes the account lines policy an InitPlan again, so the lookup runs once per statement', async () => {
    await sql`
      ALTER POLICY account_lines_isolation ON plugin_budgets.account_lines
        USING (${sql.raw(BARE)}) WITH CHECK (${sql.raw(BARE)})
    `.execute(admin)
    const explain = (): Promise<string> =>
      asUser(h.db, user.id, async (trx) => {
        const r = await sql<{ line: string }>`
          EXPLAIN (COSTS OFF) SELECT * FROM plugin_budgets.account_lines
        `.execute(trx)
        return r.rows.map((row) => Object.values(row)[0] as string).join('\n')
      })
    const user = await createUser(h)
    try {
      // Plan text differs between PostgreSQL versions (`$0` or `(InitPlan 1).col1`), so only what
      // does not: a bare call is printed in the scan condition, an InitPlan is not.
      expect(await explain()).toMatch(/(Filter|Index Cond): .*current_user_id/)
      await up(admin)
      const plan = await explain()
      expect(plan).toMatch(/InitPlan/)
      expect(plan).not.toMatch(/current_user_id/)
    } finally {
      await up(admin)
    }
  })

  it('handles a policy with only a USING clause, only a WITH CHECK clause, and a mix of both forms', async () => {
    await admin
      .transaction()
      .execute(async (trx) => {
        await sql`CREATE SCHEMA plugin_t033`.execute(trx)
        await sql`CREATE TABLE plugin_t033.t (user_id uuid NOT NULL, note text)`.execute(trx)
        await sql`ALTER TABLE plugin_t033.t ENABLE ROW LEVEL SECURITY`.execute(trx)
        await sql`CREATE POLICY only_using ON plugin_t033.t FOR SELECT USING (user_id = core.current_user_id())`.execute(trx)
        await sql`CREATE POLICY only_check ON plugin_t033.t FOR INSERT WITH CHECK (user_id = core.current_user_id())`.execute(trx)
        await sql`
          CREATE POLICY mixed ON plugin_t033.t FOR UPDATE
            USING (user_id = (SELECT core.current_user_id()) OR user_id = core.current_user_id())
            WITH CHECK (user_id = core.current_user_id())
        `.execute(trx)
        await sql`
          CREATE POLICY done ON plugin_t033.t FOR DELETE USING (user_id = (SELECT core.current_user_id()))
        `.execute(trx)
        const doneBefore = await printed(trx, 'plugin_t033.t', 'done')

        await up(trx)

        const onlyUsing = await printed(trx, 'plugin_t033.t', 'only_using')
        expect(isWrapped(onlyUsing[0]) && !isBare(onlyUsing[0])).toBe(true)
        expect(onlyUsing[1]).toBeNull()

        const onlyCheck = await printed(trx, 'plugin_t033.t', 'only_check')
        expect(onlyCheck[0]).toBeNull()
        expect(isWrapped(onlyCheck[1]) && !isBare(onlyCheck[1])).toBe(true)

        const mixed = await printed(trx, 'plugin_t033.t', 'mixed')
        expect(mixed.some(isBare)).toBe(false)
        expect(mixed.every(isWrapped)).toBe(true)

        // The command, and a policy that needed nothing, are untouched.
        const cmds = await sql<{ policyname: string; cmd: string }>`
          SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'plugin_t033' ORDER BY 1
        `.execute(trx)
        expect(cmds.rows).toEqual([
          { policyname: 'done', cmd: 'DELETE' },
          { policyname: 'mixed', cmd: 'UPDATE' },
          { policyname: 'only_check', cmd: 'INSERT' },
          { policyname: 'only_using', cmd: 'SELECT' },
        ])
        expect(await printed(trx, 'plugin_t033.t', 'done')).toEqual(doneBefore)
        throw new Rollback()
      })
      .catch((e: unknown) => {
        if (!(e instanceof Rollback)) throw e
      })
  })

  it('has a down that changes nothing', async () => {
    const before = await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')
    await down(admin)
    expect(await printed(admin, 'plugin_budgets.account_lines', 'account_lines_isolation')).toEqual(before)
  })
})
