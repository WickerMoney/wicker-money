import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db, type TransactionOptions } from '../client.js'
import {
  createHarness, createUser, TEST_ADMIN_DATABASE_URL, TEST_APP_ROLE, type Harness, type TestUser,
} from '../../testing/harness.js'
import type { Executor } from './support/index.js'
import { withOwners as withOwnersOn } from '../../testing/withOwners.js'
import { FIRST_OWNER_LOCK_KEY } from './026_first_user_owner.js'
import {
  down, LAST_OWNER_SQLSTATE, NO_SUCH_USER_SQLSTATE, OWNER_REQUIRED_SQLSTATE, up, WRONG_ISOLATION_SQLSTATE,
} from './029_owner_role_management.js'

/**
 * Migration 029: `core.list_users_for_owner` and `core.set_user_role`.
 *
 * These are the database half of the owner role screen, so what is proved
 * here is what the database refuses on its own, whatever the API does: a
 * non-owner (or an unsigned caller) gets nothing, the last owner cannot be
 * removed, and two owners demoting each other cannot leave none.
 *
 * The test database is shared and already holds owners from other suites.
 * Tests that need an exact set of owners use {@link withOwners}, which
 * demotes everyone else and puts them back afterwards; suites run one file at
 * a time, so nothing else observes the gap. `down` and `up` run inside
 * transactions that are rolled back.
 */

let h: Harness
let admin: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

interface RoleRow {
  id: string
  email: string
  role: 'owner' | 'member'
  created_at: Date
  previous_role?: 'owner' | 'member'
}

/** Lists accounts the way the API does: in a transaction bound to `callerId`. */
const listAs = (callerId: string) =>
  asUser(h.db, callerId, async (trx) => (await sql<RoleRow>`SELECT * FROM core.list_users_for_owner()`.execute(trx)).rows)

/** Changes a role the way the API does: in a transaction bound to `callerId`. */
const setRoleAs = (callerId: string, targetId: string, role: string, options?: TransactionOptions) =>
  asUser(
    h.db, callerId,
    async (trx) => (await sql<RoleRow>`SELECT * FROM core.set_user_role(${targetId}::uuid, ${role}::core.user_role)`.execute(trx)).rows[0],
    options,
  )

/** The SQLSTATE a rejected call failed with, or `undefined` if it succeeded. */
async function sqlstate(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call
    return undefined
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code'
  }
}

async function roleOf(db: Executor, id: string): Promise<string | undefined> {
  const { rows } = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${id}`.execute(db)
  return rows[0]?.role
}

async function ownersAmong(ids: string[]): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM core.users WHERE id = ANY(${ids}::uuid[]) AND role = 'owner'
  `.execute(admin)
  return rows.map((r) => r.id)
}

/** Waits until `count` sessions are blocked on the registration/role-change advisory lock. */
async function waitForBlocked(count: number): Promise<void> {
  for (let i = 0; ; i += 1) {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND ((classid::bigint << 32) | objid::bigint) = ${FIRST_OWNER_LOCK_KEY}::bigint
    `.execute(admin)
    if ((rows[0]?.n ?? 0) >= count) return
    if (i > 300) throw new Error(`only ${rows[0]?.n ?? 0} of ${count} calls ever waited on the lock`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function functionExists(db: Executor, name: string): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'core' AND p.proname = ${name}
  `.execute(db)
  return (rows[0]?.n ?? 0) > 0
}

/** Runs `fn` with exactly `owners` as the instance's owners. */
const withOwners = (owners: TestUser[], fn: () => Promise<void>): Promise<void> => withOwnersOn(admin, owners, fn)

let alice: TestUser
let bob: TestUser
let carol: TestUser
let member: TestUser

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  ;[alice, bob, carol, member] = await Promise.all([createUser(h), createUser(h), createUser(h), createUser(h)])
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('core.list_users_for_owner', () => {
  it('gives an owner every account with only id, email, role and creation time', async () => {
    await withOwners([alice], async () => {
      const rows = await listAs(alice.id)
      const mine = rows.filter((r) => [alice.id, bob.id, carol.id, member.id].includes(r.id))
      expect(mine.map((r) => r.email).sort()).toEqual([alice.email, bob.email, carol.email, member.email].sort())
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['created_at', 'email', 'id', 'role'])
      expect(rows.find((r) => r.id === alice.id)?.role).toBe('owner')
      expect(rows.find((r) => r.id === bob.id)?.role).toBe('member')
    })
  })

  it('refuses a member', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(listAs(member.id))).toBe(OWNER_REQUIRED_SQLSTATE)
    })
  })

  it('refuses a transaction with no user bound, or an id with no valid signature', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(h.db.transaction().execute((trx) => sql`SELECT * FROM core.list_users_for_owner()`.execute(trx))))
        .toBe(OWNER_REQUIRED_SQLSTATE)
      // Naming an owner's id is not enough: the id must carry a signature only the API can make.
      expect(await sqlstate(h.db.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.user_id', ${alice.id}, true)`.execute(trx)
        await sql`SELECT * FROM core.list_users_for_owner()`.execute(trx)
      }))).toBe(OWNER_REQUIRED_SQLSTATE)
    })
  })
})

describe('core.set_user_role', () => {
  it('promotes a member to owner and reports the role it replaced', async () => {
    await withOwners([alice], async () => {
      const row = await setRoleAs(alice.id, bob.id, 'owner')
      expect(row).toMatchObject({ id: bob.id, email: bob.email, role: 'owner', previous_role: 'member' })
      expect(await roleOf(admin, bob.id)).toBe('owner')
    })
  })

  it('demotes an owner while another owner remains, and the demoted account then has no owner powers', async () => {
    await withOwners([alice, bob], async () => {
      const row = await setRoleAs(alice.id, bob.id, 'member')
      expect(row).toMatchObject({ id: bob.id, role: 'member', previous_role: 'owner' })
      expect(await sqlstate(listAs(bob.id))).toBe(OWNER_REQUIRED_SQLSTATE)
    })
  })

  it('does nothing, successfully, when the account already has that role', async () => {
    await withOwners([alice, bob], async () => {
      const { rows: before } = await sql<{ updated_at: Date }>`SELECT updated_at FROM core.users WHERE id = ${bob.id}`.execute(admin)
      expect(await setRoleAs(alice.id, bob.id, 'owner')).toMatchObject({ role: 'owner', previous_role: 'owner' })
      expect(await setRoleAs(alice.id, carol.id, 'member')).toMatchObject({ role: 'member', previous_role: 'member' })
      const { rows: after } = await sql<{ updated_at: Date }>`SELECT updated_at FROM core.users WHERE id = ${bob.id}`.execute(admin)
      expect(after[0]?.updated_at).toEqual(before[0]?.updated_at)
    })
  })

  it('refuses to demote the only owner, including when they demote themselves', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(setRoleAs(alice.id, alice.id, 'member'))).toBe(LAST_OWNER_SQLSTATE)
      expect(await roleOf(admin, alice.id)).toBe('owner')
    })
  })

  it('lets an owner demote themselves when another owner remains', async () => {
    await withOwners([alice, bob], async () => {
      expect(await setRoleAs(alice.id, alice.id, 'member')).toMatchObject({ role: 'member', previous_role: 'owner' })
      expect(await ownersAmong([alice.id, bob.id])).toEqual([bob.id])
    })
  })

  it('refuses a member, including one promoting themselves', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(setRoleAs(member.id, member.id, 'owner'))).toBe(OWNER_REQUIRED_SQLSTATE)
      expect(await sqlstate(setRoleAs(member.id, bob.id, 'owner'))).toBe(OWNER_REQUIRED_SQLSTATE)
      expect(await roleOf(admin, member.id)).toBe('member')
      expect(await roleOf(admin, bob.id)).toBe('member')
    })
  })

  it('refuses an unsigned caller naming an owner', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(h.db.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.user_id', ${alice.id}, true)`.execute(trx)
        await sql`SELECT * FROM core.set_user_role(${member.id}::uuid, 'owner')`.execute(trx)
      }))).toBe(OWNER_REQUIRED_SQLSTATE)
      expect(await roleOf(admin, member.id)).toBe('member')
    })
  })

  it('reports an account that does not exist', async () => {
    await withOwners([alice], async () => {
      expect(await sqlstate(setRoleAs(alice.id, '00000000-0000-4000-8000-000000000000', 'owner'))).toBe(NO_SUCH_USER_SQLSTATE)
    })
  })

  it('refuses to run above READ COMMITTED, where its count could be stale', async () => {
    await withOwners([alice, bob], async () => {
      expect(await sqlstate(setRoleAs(alice.id, bob.id, 'member', { isolation: 'repeatable read' }))).toBe(WRONG_ISOLATION_SQLSTATE)
      expect(await sqlstate(setRoleAs(alice.id, bob.id, 'member', { isolation: 'serializable' }))).toBe(WRONG_ISOLATION_SQLSTATE)
      expect(await roleOf(admin, bob.id)).toBe('owner')
    })
  })
})

describe('two owners demoting each other', () => {
  it('leaves exactly one owner when both calls are queued on the lock together', async () => {
    await withOwners([alice, bob], async () => {
      let aliceDemotesBob: Promise<string | undefined> | undefined
      let bobDemotesAlice: Promise<string | undefined> | undefined
      // Hold the lock so both calls pass their first owner check and then wait,
      // which is the interleaving that would otherwise leave nobody in charge.
      await admin.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(${FIRST_OWNER_LOCK_KEY}::bigint)`.execute(trx)
        aliceDemotesBob = sqlstate(setRoleAs(alice.id, bob.id, 'member'))
        bobDemotesAlice = sqlstate(setRoleAs(bob.id, alice.id, 'member'))
        await waitForBlocked(2)
      })

      const outcomes = [await aliceDemotesBob, await bobDemotesAlice]
      expect(outcomes.filter((o) => o === undefined)).toHaveLength(1)
      // The loser was demoted while it waited, so it is no longer allowed to ask.
      expect(outcomes.filter((o) => o === OWNER_REQUIRED_SQLSTATE)).toHaveLength(1)
      expect(await ownersAmong([alice.id, bob.id])).toHaveLength(1)
    })
  })

  it('never leaves zero owners across repeated simultaneous rounds of three owners demoting in a ring', async () => {
    for (let round = 0; round < 12; round += 1) {
      await withOwners([alice, bob, carol], async () => {
        const results = await Promise.all([
          sqlstate(setRoleAs(alice.id, bob.id, 'member')),
          sqlstate(setRoleAs(bob.id, carol.id, 'member')),
          sqlstate(setRoleAs(carol.id, alice.id, 'member')),
        ])
        const remaining = await ownersAmong([alice.id, bob.id, carol.id])
        expect(remaining.length, `round ${round}: ${JSON.stringify(results)}`).toBeGreaterThanOrEqual(1)
        // Whatever ran, each failure is one of the two sanctioned refusals.
        for (const code of results) {
          expect([undefined, OWNER_REQUIRED_SQLSTATE, LAST_OWNER_SQLSTATE]).toContain(code)
        }
        expect(results.filter((c) => c === undefined).length + remaining.length).toBe(3)
      })
    }
  })
})

describe('registration after a promotion', () => {
  it('still makes a newcomer a member: a second owner exists only because an owner chose it', async () => {
    await withOwners([alice], async () => {
      await setRoleAs(alice.id, bob.id, 'owner')
      const newcomer = await createUser(h)
      expect(await roleOf(admin, newcomer.id)).toBe('member')
      expect(await ownersAmong([alice.id, bob.id, newcomer.id]).then((o) => o.sort())).toEqual([alice.id, bob.id].sort())
    })
  })

  it('does not stop the next registration becoming the owner once the last owner is gone', async () => {
    // The operator can still demote everyone in SQL; nothing here changes that rule.
    await withOwners([], async () => {
      const first = await createUser(h)
      expect(await roleOf(admin, first.id)).toBe('owner')
    })
  })
})

describe('the migration itself', () => {
  it('installs both functions for the application role only', async () => {
    for (const signature of ['core.list_users_for_owner()', 'core.set_user_role(uuid, core.user_role)']) {
      const { rows } = await sql<{ public: boolean; app: boolean }>`
        SELECT has_function_privilege('public', ${signature}, 'EXECUTE') AS public,
               has_function_privilege(${TEST_APP_ROLE}, ${signature}, 'EXECUTE') AS app
      `.execute(admin)
      expect(rows[0], signature).toEqual({ public: false, app: true })
    }
  })

  it('runs as the table owner with a pinned search path', async () => {
    const { rows } = await sql<{ proname: string; secdef: boolean; config: string[] | null }>`
      SELECT p.proname, p.prosecdef AS secdef, p.proconfig AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'core' AND p.proname IN ('list_users_for_owner', 'set_user_role')
    `.execute(admin)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.secdef, row.proname).toBe(true)
      expect(row.config?.some((c) => c.startsWith('search_path=')), row.proname).toBe(true)
    }
  })

  it('is a no-op on a second run', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      await up(trx)
      expect(await functionExists(trx, 'set_user_role')).toBe(true)
      expect(await functionExists(trx, 'list_users_for_owner')).toBe(true)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
  })

  it('down drops both functions, leaves roles as they are, and up brings them back', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      const before = await roleOf(trx, alice.id)
      await down(trx)
      expect(await functionExists(trx, 'set_user_role')).toBe(false)
      expect(await functionExists(trx, 'list_users_for_owner')).toBe(false)
      expect(await roleOf(trx, alice.id)).toBe(before)

      await down(trx) // dropping twice is harmless
      await up(trx)
      expect(await functionExists(trx, 'set_user_role')).toBe(true)
      expect(await functionExists(trx, 'list_users_for_owner')).toBe(true)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
    expect(await functionExists(admin, 'set_user_role')).toBe(true)
  })
})
