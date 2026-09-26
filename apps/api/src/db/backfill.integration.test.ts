import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { backfillOnboarded } from './migrations/010_onboarding.js'
import { withOwnerBackfillAccess } from './migrations/support/index.js'
import { asUser, createDb, type Db } from './client.js'
import { auth, createHarness, createUser, type Harness, type TestUser } from '../testing/harness.js'

/**
 * Proves the onboarding backfill actually marks anyone.
 *
 * A backfill that reads correctly can still do nothing at all: it runs as the
 * table owner, `core.categories` has FORCE row-level security, and FORCE is
 * precisely what strips the owner's exemption. The EXISTS matched no rows for
 * every user in every install, and the migration reported success.
 *
 * Nothing about that is visible from the migration's output, so the only way to
 * know is to run it against a database with real rows and look. It runs on the
 * owner connection, the same one the migrator uses — a test that used the
 * application role would be testing a different thing and would pass either way.
 */
let h: Harness
let owner: Db
let user: TestUser

async function onboardedAt(id: string): Promise<Date | null> {
  const r = await sql<{ onboarded_at: Date | null }>`
    SELECT onboarded_at FROM core.users WHERE id = ${id}
  `.execute(owner)
  return r.rows[0]?.onboarded_at ?? null
}

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(
    process.env['TEST_ADMIN_DATABASE_URL'] ?? 'postgresql://postgres@localhost:5432/wickermoney_test',
  )
  user = await createUser(h)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('the onboarding backfill', () => {
  it('sees categories that row-level security hides from the owner by default', async () => {
    // The bug, stated as an assertion: this is what the naive EXISTS could see.
    const blind = await sql<{ n: string }>`SELECT count(*) AS n FROM core.categories`.execute(owner)
    expect(Number(blind.rows[0]?.n)).toBe(0)
  })

  it('marks a user who already has categories', async () => {
    await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Groceries', slug: 'groceries' },
    })
    await sql`UPDATE core.users SET onboarded_at = NULL WHERE id = ${user.id}`.execute(owner)

    await backfillOnboarded(owner)

    expect(await onboardedAt(user.id)).not.toBeNull()
  })

  it('leaves a user with no categories alone', async () => {
    const fresh = await createUser(h)
    await sql`UPDATE core.users SET onboarded_at = NULL WHERE id = ${fresh.id}`.execute(owner)

    await backfillOnboarded(owner)

    // Someone who has never had a category has never been through setup, which
    // is the whole population the wizard is for.
    expect(await onboardedAt(fresh.id)).toBeNull()
  })

  it('puts FORCE row-level security back', async () => {
    await backfillOnboarded(owner)

    const r = await sql<{ relforcerowsecurity: boolean }>`
      SELECT relforcerowsecurity FROM pg_class
      WHERE oid = 'core.categories'::regclass
    `.execute(owner)
    // Leaving it off would silently hand every later query the owner makes a
    // view of every user's data — a far worse bug than the one it fixes.
    expect(r.rows[0]?.relforcerowsecurity).toBe(true)
  })
})

describe('the category kind backfill', () => {
  it('marks the Income branch, which row-level security hides from the owner', async () => {
    const { backfillCategoryKinds } = await import('./migrations/012_kinds_and_transfers.js')

    const income = await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Income', slug: 'income' },
    })
    const incomeId = (income.json() as { id: string }).id
    await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Salary', slug: 'salary', parentId: incomeId },
    })
    // Force both back to the default, as a database that predates category kinds would have them.
    await asUser(h.db, user.id, async (trx) => {
      await sql`UPDATE core.categories SET kind = 'expense'`.execute(trx)
    })

    await backfillCategoryKinds(owner)

    const kinds = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ slug: string; kind: string }>`
        SELECT slug, kind::text FROM core.categories WHERE slug IN ('income', 'salary')
      `.execute(trx)
      return Object.fromEntries(r.rows.map((x) => [x.slug, x.kind]))
    })

    // A backfill run as the owner with FORCE RLS in the way updates zero rows
    // however many categories exist, and still reports success.
    expect(kinds['income']).toBe('income')
    expect(kinds['salary']).toBe('income')
  })

  it('leaves an ordinary spending category alone', async () => {
    const { backfillCategoryKinds } = await import('./migrations/012_kinds_and_transfers.js')
    await h.app.inject({
      method: 'POST', url: '/api/v1/categories', headers: auth(user),
      payload: { name: 'Fuel', slug: 'fuel' },
    })

    await backfillCategoryKinds(owner)

    const kind = await asUser(h.db, user.id, async (trx) => {
      const r = await sql<{ kind: string }>`
        SELECT kind::text FROM core.categories WHERE slug = 'fuel'
      `.execute(trx)
      return r.rows[0]?.kind
    })
    expect(kind).toBe('expense')
  })

  it('puts FORCE row-level security back', async () => {
    const { backfillCategoryKinds } = await import('./migrations/012_kinds_and_transfers.js')
    await backfillCategoryKinds(owner)

    const r = await sql<{ relforcerowsecurity: boolean }>`
      SELECT relforcerowsecurity FROM pg_class
      WHERE oid = 'core.categories'::regclass
    `.execute(owner)
    // Leaving it off would silently hand every later query the owner makes a
    // view of every user's categories.
    expect(r.rows[0]?.relforcerowsecurity).toBe(true)
  })
})

describe('the transfer leg backfill', () => {
  it('gives a one-sided transfer its missing leg, once', async () => {
    const { backfillTransferLegs } = await import('./migrations/012_kinds_and_transfers.js')
    const u = await createUser(h)
    // The completeness constraint would refuse the one-sided row, exactly as it
    // does not exist yet on a database that predates it.
    await sql`ALTER TABLE core.transactions DROP CONSTRAINT ck_transactions_transfer_complete`.execute(owner)
    try {
      await asUser(h.db, u.id, async (trx) => {
        const a = await sql<{ id: string }>`
          INSERT INTO core.accounts (user_id, name, account_type) VALUES (${u.id}, 'A', 'checking') RETURNING id`.execute(trx)
        const b = await sql<{ id: string }>`
          INSERT INTO core.accounts (user_id, name, account_type) VALUES (${u.id}, 'B', 'savings') RETURNING id`.execute(trx)
        await sql`
          INSERT INTO core.transactions (user_id, account_id, amount, merchant, transaction_date, transfer_account_id)
          VALUES (${u.id}, ${a.rows[0]!.id}, -50, 'Move', CURRENT_DATE, ${b.rows[0]!.id})`.execute(trx)
      })

      await backfillTransferLegs(owner)
      await backfillTransferLegs(owner)

      const legs = await asUser(h.db, u.id, async (trx) => {
        const r = await sql<{ amount: string; transfer_id: string | null }>`
          SELECT amount::text, transfer_id::text FROM core.transactions ORDER BY amount`.execute(trx)
        return r.rows
      })
      expect(legs.map((l) => l.amount)).toEqual(['-50.0000', '50.0000'])
      expect(legs[0]?.transfer_id).not.toBeNull()
      expect(legs[0]?.transfer_id).toBe(legs[1]?.transfer_id)
    } finally {
      await sql`
        ALTER TABLE core.transactions ADD CONSTRAINT ck_transactions_transfer_complete
          CHECK ((transfer_id IS NULL) = (transfer_account_id IS NULL))`.execute(owner)
    }
  })
})

describe('the temporary owner policy the backfills run under', () => {
  async function backfillPolicies(): Promise<number> {
    const r = await sql<{ n: string }>`
      SELECT count(*) AS n FROM pg_policies WHERE policyname = 'migration_backfill'
    `.execute(owner)
    return Number(r.rows[0]?.n)
  }

  it('is gone once a backfill has finished', async () => {
    await backfillOnboarded(owner)
    expect(await backfillPolicies()).toBe(0)
  })

  it('is rolled back with the transaction when the backfill fails', async () => {
    await expect(
      withOwnerBackfillAccess(owner, ['core.categories', 'core.transactions'], async (trx) => {
        // The policy is in force here: the owner can see through FORCE.
        const seen = await sql<{ n: string }>`SELECT count(*) AS n FROM core.categories`.execute(trx)
        expect(Number(seen.rows[0]?.n)).toBeGreaterThan(0)
        throw new Error('backfill failed')
      }),
    ).rejects.toThrow('backfill failed')

    expect(await backfillPolicies()).toBe(0)
  })

  it('applies to the connected owner role only, never to the application role', async () => {
    const roles = await withOwnerBackfillAccess(owner, ['core.categories'], async (trx) => {
      const r = await sql<{ roles: string[]; current_user: string }>`
        SELECT roles::text[] AS roles, current_user::text AS current_user
        FROM pg_policies WHERE policyname = 'migration_backfill'
      `.execute(trx)
      return r.rows
    })
    expect(roles).toHaveLength(1)
    expect(roles[0]?.roles).toEqual([roles[0]?.current_user])
  })
})
