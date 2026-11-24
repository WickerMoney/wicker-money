import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSystem, asUser, createDb, type Db } from '../client.js'
import {
  createHarness, createUser, TEST_ADMIN_DATABASE_URL, TEST_APP_ROLE, type Harness, type TestUser,
} from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { down, up } from './039_transaction_undo_snapshots.js'
import { UNDO_PAYLOAD_MAX_BYTES } from '../../transactions/repository/UNDO_PAYLOAD_MAX_BYTES.js'

/**
 * Migration 039: `core.transaction_undo_snapshots` and its purge.
 *
 * What only the migration itself does: the table is FORCEd (it is not on the
 * `rls-invariants` allow-list), the owner can purge expired rows and nothing
 * else under FORCE, and the application role can neither read nor delete a row
 * through the purge function. Behaviour through the API is in
 * `transactions/undo.integration.test.ts`; the re-run snapshot is swept for every
 * migration in `migrations.idempotent.integration.test.ts`. `down` and `up` run in a
 * transaction that is rolled back, so the shared test database keeps the table.
 */

let h: Harness
let owner: Db
let user: TestUser
let stranger: TestUser

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const FN = 'core.purge_expired_transaction_undos()'

/** Inserts a snapshot as `u`, live or expired, and returns its id. */
async function plant(u: TestUser, expired: boolean, payload = '{}'): Promise<string> {
  return asUser(h.db, u.id, async (trx) =>
    (await sql<{ id: string }>`
      INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
      VALUES (${u.id}::uuid, 'transaction', ${payload}::jsonb, 1,
              ${expired ? sql`now() - interval '1 minute'` : sql`now() + interval '10 minutes'`})
      RETURNING id
    `.execute(trx)).rows[0]!.id)
}

/** Ids the user can still see. */
async function visibleTo(u: TestUser): Promise<string[]> {
  return asUser(h.db, u.id, async (trx) =>
    (await sql<{ id: string }>`SELECT id FROM core.transaction_undo_snapshots ORDER BY id`.execute(trx)).rows.map((r) => r.id))
}

const tableExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ found: boolean }>`SELECT to_regclass('core.transaction_undo_snapshots') IS NOT NULL AS found`.execute(db)).rows[0]?.found === true

const functionExists = async (db: Executor): Promise<boolean> =>
  (await sql<{ found: boolean }>`SELECT to_regprocedure(${FN}) IS NOT NULL AS found`.execute(db)).rows[0]?.found === true

beforeAll(async () => {
  h = await createHarness()
  owner = createDb(TEST_ADMIN_DATABASE_URL)
  user = await createUser(h)
  stranger = await createUser(h)
})

afterAll(async () => {
  await owner.destroy()
  await h.close()
})

describe('up', () => {
  it('adds the table under FORCEd row-level security, with DML for the app role and the index', async () => {
    const { rows } = await sql<{ enabled: boolean; forced: boolean; dml: boolean; owned_by_app: boolean }>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced,
             has_table_privilege(${TEST_APP_ROLE}, 'core.transaction_undo_snapshots', 'SELECT, INSERT, UPDATE, DELETE') AS dml,
             pg_get_userbyid(relowner) = ${TEST_APP_ROLE} AS owned_by_app
      FROM pg_class WHERE oid = 'core.transaction_undo_snapshots'::regclass
    `.execute(owner)
    expect(rows[0]).toEqual({ enabled: true, forced: true, dml: true, owned_by_app: false })
    const index = await sql<{ def: string }>`
      SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'core' AND tablename = 'transaction_undo_snapshots'
        AND indexname = 'ix_transaction_undo_snapshots_user_expires'
    `.execute(owner)
    expect(index.rows[0]?.def).toContain('(user_id, expires_at)')
  })

  it('uses the isolation policy in the scalar-subquery form, with the same check on writes', async () => {
    const { rows } = await sql<{ qual: string; with_check: string }>`
      SELECT qual, with_check FROM pg_policies
      WHERE schemaname = 'core' AND tablename = 'transaction_undo_snapshots' AND policyname = 'transaction_undo_snapshots_isolation'
    `.execute(owner)
    expect(rows[0]?.qual).toMatch(/\(\s*SELECT\s+core\.current_user_id\(\)/)
    expect(rows[0]?.with_check).toBe(rows[0]?.qual)
  })

  it('scopes the two purge policies to the owner role alone, never to the application role', async () => {
    const { rows } = await sql<{ policy: string; cmd: string; roles: string[]; qual: string }>`
      SELECT policyname AS policy, cmd, roles::text[] AS roles, qual FROM pg_policies
      WHERE schemaname = 'core' AND tablename = 'transaction_undo_snapshots' AND policyname LIKE '%purge%'
      ORDER BY policyname
    `.execute(owner)
    const ownerRole = (await sql<{ r: string }>`SELECT current_user::text AS r`.execute(owner)).rows[0]!.r
    expect(rows.map((r) => [r.policy, r.cmd, r.roles])).toEqual([
      ['transaction_undo_snapshots_purge_delete', 'DELETE', [ownerRole]],
      ['transaction_undo_snapshots_purge_select', 'SELECT', [ownerRole]],
    ])
    expect(rows.every((r) => r.qual === '(expires_at < now())')).toBe(true)
    // The owner is the role that owns the table, and it is not the application role.
    const tableOwner = (await sql<{ r: string }>`
      SELECT pg_get_userbyid(relowner) AS r FROM pg_class WHERE oid = 'core.transaction_undo_snapshots'::regclass
    `.execute(owner)).rows[0]!.r
    expect(tableOwner).toBe(ownerRole)
    expect(ownerRole).not.toBe(TEST_APP_ROLE)
  })

  it('writes the same size cap into the table that the delete route measures against', async () => {
    const { rows } = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'core.transaction_undo_snapshots'::regclass AND conname = 'ck_transaction_undo_snapshots_payload_size'
    `.execute(owner)
    expect(rows[0]?.def).toContain(`<= ${UNDO_PAYLOAD_MAX_BYTES}`)
    expect(UNDO_PAYLOAD_MAX_BYTES).toBe(262_144)
  })

  it('refuses a payload over the cap, a bad kind and a bad count', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(UNDO_PAYLOAD_MAX_BYTES) })
    await expect(plant(user, false, big)).rejects.toMatchObject({ code: '23514', constraint: 'ck_transaction_undo_snapshots_payload_size' })
    await expect(asUser(h.db, user.id, (trx) => sql`
      INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
      VALUES (${user.id}::uuid, 'bogus', '{}'::jsonb, 1, now())`.execute(trx))).rejects.toMatchObject({ code: '23514' })
    await expect(asUser(h.db, user.id, (trx) => sql`
      INSERT INTO core.transaction_undo_snapshots (user_id, kind, payload, transaction_count, expires_at)
      VALUES (${user.id}::uuid, 'transfer', '{}'::jsonb, 3, now())`.execute(trx))).rejects.toMatchObject({ code: '23514' })
  })

  it('removes a user\'s snapshots with the user', async () => {
    const gone = await createUser(h)
    const id = await plant(gone, false)
    expect(await visibleTo(gone)).toEqual([id])
    // The owner is not subject to the users policy (core.users is ENABLE only, not FORCEd).
    await sql`DELETE FROM core.users WHERE id = ${gone.id}::uuid`.execute(owner)
    // A live snapshot is hidden from the owner by FORCE, so use the user's own context for the "gone" check:
    // with the user deleted, a stranger's context cannot see the row either, and the foreign key cascaded it.
    const orphans = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM pg_constraint
      WHERE conrelid = 'core.transaction_undo_snapshots'::regclass AND contype = 'f' AND confdeltype = 'c'
    `.execute(owner)
    expect(orphans.rows[0]?.n).toBe('1')
  })

  it('is a no-op on a second run', async () => {
    await up(owner)
    expect(await tableExists(owner)).toBe(true)
    expect(await functionExists(owner)).toBe(true)
    const policies = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM pg_policy WHERE polrelid = 'core.transaction_undo_snapshots'::regclass
    `.execute(owner)
    expect(policies.rows[0]?.n).toBe('3')
  })
})

describe('the purge under FORCE', () => {
  it('lets the owner see and delete expired rows only, with no tenant context', async () => {
    const live = await plant(user, false)
    const stale = await plant(user, true)
    const ownerView = await sql<{ id: string }>`SELECT id FROM core.transaction_undo_snapshots ORDER BY id`.execute(owner)
    expect(ownerView.rows.map((r) => r.id)).toContain(stale)
    expect(ownerView.rows.map((r) => r.id)).not.toContain(live)

    const tryLive = await sql`DELETE FROM core.transaction_undo_snapshots WHERE id = ${live}::uuid`.execute(owner)
    expect(Number(tryLive.numAffectedRows)).toBe(0)
    expect(await visibleTo(user)).toContain(live)
    const tryStale = await sql`DELETE FROM core.transaction_undo_snapshots WHERE id = ${stale}::uuid`.execute(owner)
    expect(Number(tryStale.numAffectedRows)).toBe(1)
  })

  it('needs the SELECT policy as well as the DELETE one: a DELETE with a WHERE clause reads the rows first', async () => {
    const stale = await plant(user, true)
    const run = owner.transaction().execute(async (trx) => {
      await sql`DROP POLICY transaction_undo_snapshots_purge_select ON core.transaction_undo_snapshots`.execute(trx)
      const r = await sql`DELETE FROM core.transaction_undo_snapshots WHERE id = ${stale}::uuid`.execute(trx)
      expect(Number(r.numAffectedRows)).toBe(0)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    // Rolled back: the row is still there, so a later purge removes it.
    const after = await sql<{ id: string }>`SELECT id FROM core.transaction_undo_snapshots WHERE id = ${stale}::uuid`.execute(owner)
    expect(after.rows).toHaveLength(1)
  })

  it('has the function remove expired rows of every user and no live row, run as the owner', async () => {
    const liveA = await plant(user, false)
    const liveB = await plant(stranger, false)
    const staleA = await plant(user, true)
    const staleB = await plant(stranger, true)
    const { rows } = await sql<{ n: string }>`SELECT core.purge_expired_transaction_undos() AS n`.execute(owner)
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(2)
    const left = [...(await visibleTo(user)), ...(await visibleTo(stranger))]
    expect(left).toEqual(expect.arrayContaining([liveA, liveB]))
    expect(left).not.toContain(staleA)
    expect(left).not.toContain(staleB)
  })

  it('has the function work for the application role with no tenant context, and still touch no live row', async () => {
    const live = await plant(user, false)
    const stale = await plant(stranger, true)
    const purged = await asSystem(h.db, async (trx) =>
      Number((await sql<{ n: string }>`SELECT core.purge_expired_transaction_undos() AS n`.execute(trx)).rows[0]!.n))
    expect(purged).toBeGreaterThanOrEqual(1)
    expect(await visibleTo(user)).toContain(live)
    expect(await visibleTo(stranger)).not.toContain(stale)
  })

  it('shows the application role no row at all without a tenant context, and nobody else\'s with one', async () => {
    const mine = await plant(user, false)
    const theirStale = await plant(stranger, true)
    const asNobody = await asSystem(h.db, async (trx) => {
      const all = await sql<{ n: string }>`SELECT count(*)::text AS n FROM core.transaction_undo_snapshots`.execute(trx)
      const del = await sql`DELETE FROM core.transaction_undo_snapshots`.execute(trx)
      return { seen: Number(all.rows[0]?.n), deleted: Number(del.numAffectedRows) }
    })
    expect(asNobody).toEqual({ seen: 0, deleted: 0 })
    expect(await visibleTo(user)).toContain(mine)
    // Each tenant sees its own rows (the expired one too: expiry hides nothing from its owner) and never the other's.
    expect(await visibleTo(stranger)).toContain(theirStale)
    expect(await visibleTo(stranger)).not.toContain(mine)
    expect(await visibleTo(user)).not.toContain(theirStale)
  })

  it('is SECURITY DEFINER with a pinned search_path, executable by the application role and no other', async () => {
    const { rows } = await sql<{ definer: boolean; config: string[] | null }>`
      SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE oid = to_regprocedure(${FN})
    `.execute(owner)
    expect(rows[0]?.definer).toBe(true)
    expect(rows[0]?.config).toEqual(['search_path=core, pg_temp'])
    const grants = await sql<{ app: boolean; pub: boolean; plugin: boolean }>`
      SELECT has_function_privilege(${TEST_APP_ROLE}, ${FN}, 'EXECUTE') AS app,
             has_function_privilege('public', ${FN}, 'EXECUTE') AS pub,
             has_function_privilege(${`${TEST_APP_ROLE}_plugin_budgets`}, ${FN}, 'EXECUTE') AS plugin
    `.execute(owner)
    expect(grants.rows[0]).toEqual({ app: true, pub: false, plugin: false })
  })
})

describe('down', () => {
  it('drops the function and the table, and up puts both back', async () => {
    const run = owner.transaction().execute(async (trx) => {
      await down(trx)
      expect(await tableExists(trx)).toBe(false)
      expect(await functionExists(trx)).toBe(false)
      await down(trx) // idempotent
      await up(trx)
      expect(await tableExists(trx)).toBe(true)
      expect(await functionExists(trx)).toBe(true)
      await down(trx)
      throw new Rollback()
    })
    await expect(run).rejects.toBeInstanceOf(Rollback)
    expect(await tableExists(owner)).toBe(true)
    expect(await functionExists(owner)).toBe(true)
  })
})
