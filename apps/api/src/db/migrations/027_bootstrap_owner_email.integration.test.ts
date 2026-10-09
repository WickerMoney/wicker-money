import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../client.js'
import { createHarness, TEST_ADMIN_DATABASE_URL, type Harness } from '../../testing/harness.js'
import { BOOTSTRAP_OWNER_SETTING } from '../../auth/repository/BOOTSTRAP_OWNER_SETTING.js'
import type { Executor } from './support/index.js'
import { down, up } from './027_bootstrap_owner_email.js'

/**
 * Migration 027: a configured owner email decides who becomes the owner,
 * without weakening migration 026's guarantee of one owner per race.
 *
 * Like the 026 suite, tests that need "no owner yet" demote the owners the
 * shared database already holds and promote them back afterwards; suites run
 * one file at a time. `up` and `down` run inside transactions that are rolled
 * back, so every other suite keeps the migrated function.
 */

const PASSWORD = 'correct-horse-battery-staple'

let h: Harness
let admin: Db

/** Rolls a transaction back after the assertions inside it have run. */
class Rollback extends Error {}

const email = (): string => `bootstrap-test-${randomUUID()}@example.com`

/**
 * Calls the registration function the way the API's repository does: the
 * configured email goes in as a transaction-local setting first (when there is
 * one), then `core.register_user` runs in the same transaction.
 */
async function registerRaw(db: Executor, address: string, bootstrap?: string): Promise<string> {
  if (bootstrap !== undefined) {
    await sql`SELECT set_config(${BOOTSTRAP_OWNER_SETTING}, ${bootstrap}, true)`.execute(db)
  }
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM core.register_user(${address}, 'not-a-real-digest')
  `.execute(db)
  const id = rows[0]?.id
  if (id === undefined) throw new Error('register_user returned no row')
  return id
}

/** One registration in its own committed transaction on the application connection. */
function register(address: string, bootstrap?: string): Promise<string> {
  return h.db.transaction().execute((trx) => registerRaw(trx, address, bootstrap))
}

async function roleOf(db: Executor, id: string): Promise<string | undefined> {
  const { rows } = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${id}`.execute(db)
  return rows[0]?.role
}

async function ownerCount(ids: string[]): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM core.users WHERE id = ANY(${ids}::uuid[]) AND role = 'owner'
  `.execute(admin)
  return rows[0]?.n ?? 0
}

/**
 * Runs `fn` on an instance with no owner: every current owner is demoted
 * first and promoted back afterwards, whatever happens.
 */
async function withNoOwners(fn: () => Promise<void>): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    UPDATE core.users SET role = 'member' WHERE role = 'owner' RETURNING id
  `.execute(admin)
  const owners = rows.map((r) => r.id)
  try {
    await fn()
  } finally {
    if (owners.length > 0) {
      await sql`UPDATE core.users SET role = 'owner' WHERE id = ANY(${owners}::uuid[])`.execute(admin)
    }
  }
}

async function registerViaApi(app: Harness['app'], address: string): Promise<{ status: number; role?: string; id?: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: address, password: PASSWORD } })
  const user = (res.json() as { user?: { id: string; role: string } }).user
  return { status: res.statusCode, role: user?.role, id: user?.id }
}

async function registrationFunctionDef(db: Executor): Promise<string> {
  const { rows } = await sql<{ def: string }>`
    SELECT pg_get_functiondef('core.register_user(text, text)'::regprocedure) AS def
  `.execute(db)
  return rows[0]?.def ?? ''
}

async function hasUsersFunction(db: Executor): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'core' AND p.proname = 'instance_has_users'
  `.execute(db)
  return (rows[0]?.n ?? 0) > 0
}

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('without a configured email', () => {
  it('keeps the first registrant as owner and everyone after as members', async () => {
    await withNoOwners(async () => {
      const [first, second] = [await register(email()), await register(email())]
      expect([await roleOf(admin, first), await roleOf(admin, second)]).toEqual(['owner', 'member'])
    })
  })

  it('treats a blank setting like no setting', async () => {
    await withNoOwners(async () => {
      for (const blank of ['', '   ']) {
        const id = await register(email(), blank)
        // The first blank one becomes the owner; the second finds an owner.
        expect(await roleOf(admin, id)).toBe(blank === '' ? 'owner' : 'member')
      }
    })
  })

  it('does not leak a setting from an earlier transaction on the same connection', async () => {
    await withNoOwners(async () => {
      const boss = email()
      const strangerId = await h.db.connection().execute(async (conn) => {
        // First transaction names someone else as the owner and commits...
        await conn.transaction().execute((trx) => registerRaw(trx, email(), boss))
        // ...a later one, with no setting, must follow the plain first-account rule.
        return conn.transaction().execute((trx) => registerRaw(trx, email()))
      })
      expect(await roleOf(admin, strangerId)).toBe('owner')
    })
  })
})

describe('with a configured email', () => {
  it('makes a non-matching first registrant a member, and the matching email the owner afterwards', async () => {
    await withNoOwners(async () => {
      const boss = email()
      const stranger = await register(email(), boss)
      const other = await register(email(), boss)
      expect([await roleOf(admin, stranger), await roleOf(admin, other)]).toEqual(['member', 'member'])
      expect(await ownerCount([stranger, other])).toBe(0)

      const owner = await register(boss, boss)
      expect(await roleOf(admin, owner)).toBe('owner')
      // And nobody after that.
      expect(await roleOf(admin, await register(email(), boss))).toBe('member')
    })
  })

  it('makes the matching email the owner when it registers first', async () => {
    await withNoOwners(async () => {
      const boss = email()
      expect(await roleOf(admin, await register(boss, boss))).toBe('owner')
    })
  })

  it('compares without regard to case or surrounding spaces, on both sides', async () => {
    await withNoOwners(async () => {
      const boss = `Boss-${randomUUID()}@Example.COM`
      // Setting in mixed case with spaces, registrant in lower case.
      const owner = await register(boss.toLowerCase(), `  ${boss}  `)
      expect(await roleOf(admin, owner)).toBe('owner')
    })
    await withNoOwners(async () => {
      const boss = `boss-${randomUUID()}@example.com`
      // Registrant in upper case with spaces, setting in lower case.
      const owner = await register(`  ${boss.toUpperCase()} `, boss)
      expect(await roleOf(admin, owner)).toBe('owner')
    })
  })

  it('does not make a second owner while one exists, and never changes anyone else', async () => {
    await withNoOwners(async () => {
      const incumbent = await register(email())
      expect(await roleOf(admin, incumbent)).toBe('owner')
      const member = await register(email())

      const boss = email()
      const late = await register(boss, boss)
      expect(await roleOf(admin, late)).toBe('member')
      expect(await roleOf(admin, incumbent)).toBe('owner')
      expect(await roleOf(admin, member)).toBe('member')
    })
  })

  it('still reports a duplicate bootstrap email as a duplicate', async () => {
    const boss = email()
    await register(boss, boss)
    await expect(register(boss, boss)).rejects.toMatchObject({ code: '23505' })
  })

  it('produces exactly one owner, the bootstrap email, from a burst of simultaneous registrations', async () => {
    // Several rounds, with the matching registration at a different position each time.
    for (let round = 0; round < 5; round += 1) {
      await withNoOwners(async () => {
        const boss = email()
        const addresses = Array.from({ length: 5 }, () => email())
        addresses[round] = boss
        const ids = await Promise.all(addresses.map((address) => register(address, boss)))
        expect(await ownerCount(ids)).toBe(1)
        expect(await roleOf(admin, ids[round] as string)).toBe('owner')
      })
    }
  })

  it('serializes the matching registration behind a held lock rather than skipping it', async () => {
    // A plain registration (no setting) holds the first-owner lock and an uncommitted owner row;
    // the matching one waits for it, then finds an owner and becomes a member.
    await withNoOwners(async () => {
      let waiting: Promise<string> | undefined
      let holderId = ''
      const boss = email()
      await admin.transaction().execute(async (trx) => {
        holderId = await registerRaw(trx, email())
        waiting = register(boss, boss)
        await new Promise((r) => setTimeout(r, 300))
      })
      expect(await roleOf(admin, holderId)).toBe('owner')
      expect(await roleOf(admin, await waiting!)).toBe('member')
    })
  })
})

describe('through the API', () => {
  it('makes only the configured email the owner, whoever registers first', async () => {
    const boss = email()
    const configured = await createHarness({ BOOTSTRAP_OWNER_EMAIL: boss.toUpperCase() })
    try {
      await withNoOwners(async () => {
        const results = await Promise.all([
          registerViaApi(configured.app, email()),
          registerViaApi(configured.app, email()),
          registerViaApi(configured.app, boss.toUpperCase()),
          registerViaApi(configured.app, email()),
          registerViaApi(configured.app, email()),
        ])
        expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
        expect(results.map((r) => r.role)).toEqual(['member', 'member', 'owner', 'member', 'member'])
        expect(await ownerCount(results.map((r) => r.id as string))).toBe(1)
      })
    } finally {
      await configured.close()
    }
  })

  it('lets registration_disabled win over the bootstrap email', async () => {
    const boss = email()
    const closed = await createHarness({ BOOTSTRAP_OWNER_EMAIL: boss, REGISTRATION_ENABLED: 'false' })
    try {
      await withNoOwners(async () => {
        const res = await closed.app.inject({
          method: 'POST', url: '/api/v1/auth/register', payload: { email: boss, password: PASSWORD },
        })
        expect(res.statusCode).toBe(403)
        expect(res.json()).toMatchObject({ code: 'registration_disabled' })
        const { rows } = await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.users WHERE email = ${boss}`.execute(admin)
        expect(rows[0]?.n).toBe(0)
      })
    } finally {
      await closed.close()
    }
  })

  it('keeps first-registrant-wins when the email is not configured', async () => {
    await withNoOwners(async () => {
      expect((await registerViaApi(h.app, email())).role).toBe('owner')
      expect((await registerViaApi(h.app, email())).role).toBe('member')
    })
  })
})

describe('core.instance_has_users', () => {
  it('tells the application role whether any account exists, which it cannot count itself', async () => {
    await register(email())
    const direct = await sql<{ n: number }>`SELECT count(*)::int AS n FROM core.users`.execute(h.db)
    expect(direct.rows[0]?.n).toBe(0) // row-level security shows the application role nothing
    const { rows } = await sql<{ has: boolean }>`SELECT core.instance_has_users() AS has`.execute(h.db)
    expect(rows[0]?.has).toBe(true)
  })

  it('is false on an instance with no accounts', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      await sql`DELETE FROM core.users`.execute(trx)
      const { rows } = await sql<{ has: boolean }>`SELECT core.instance_has_users() AS has`.execute(trx)
      expect(rows[0]?.has).toBe(false)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
  })

  it('is executable by the application role only', async () => {
    const { rows } = await sql<{ public: boolean; app: boolean }>`
      SELECT has_function_privilege('public', 'core.instance_has_users()', 'EXECUTE') AS public,
             has_function_privilege(${'wickermoney_app_test'}, 'core.instance_has_users()', 'EXECUTE') AS app
    `.execute(admin)
    expect(rows[0]).toEqual({ public: false, app: true })
  })
})

describe('the migration itself', () => {
  it('keeps the registration function signature and its grants', async () => {
    const { rows } = await sql<{ public: boolean; app: boolean }>`
      SELECT has_function_privilege('public', 'core.register_user(text, text)', 'EXECUTE') AS public,
             has_function_privilege(${'wickermoney_app_test'}, 'core.register_user(text, text)', 'EXECUTE') AS app
    `.execute(admin)
    expect(rows[0]).toEqual({ public: false, app: true })
    expect(await registrationFunctionDef(admin)).toContain(BOOTSTRAP_OWNER_SETTING)
  })

  it('is a no-op on a second run', async () => {
    const before = await registrationFunctionDef(admin)
    await expect(admin.transaction().execute(async (trx) => {
      await up(trx)
      expect(await registrationFunctionDef(trx)).toBe(before)
      expect(await hasUsersFunction(trx)).toBe(true)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
  })

  it('down restores the first-account rule and drops the helper, and up brings both back', async () => {
    await expect(admin.transaction().execute(async (trx) => {
      await sql`UPDATE core.users SET role = 'member' WHERE role = 'owner'`.execute(trx)
      await down(trx)
      expect(await registrationFunctionDef(trx)).not.toContain(BOOTSTRAP_OWNER_SETTING)
      expect(await hasUsersFunction(trx)).toBe(false)
      // The setting is ignored again: a stranger registering first is the owner.
      expect(await roleOf(trx, await registerRaw(trx, email(), email()))).toBe('owner')

      await sql`UPDATE core.users SET role = 'member' WHERE role = 'owner'`.execute(trx)
      await up(trx)
      expect(await registrationFunctionDef(trx)).toContain(BOOTSTRAP_OWNER_SETTING)
      expect(await hasUsersFunction(trx)).toBe(true)
      expect(await roleOf(trx, await registerRaw(trx, email(), email()))).toBe('member')
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
    expect(await registrationFunctionDef(admin)).toContain(BOOTSTRAP_OWNER_SETTING)
  })

  it('leaves existing accounts exactly as they are', async () => {
    const before = await sql<{ id: string; role: string }>`SELECT id, role::text AS role FROM core.users ORDER BY id`.execute(admin)
    await expect(admin.transaction().execute(async (trx) => {
      await up(trx)
      await down(trx)
      await up(trx)
      const after = await sql<{ id: string; role: string }>`SELECT id, role::text AS role FROM core.users ORDER BY id`.execute(trx)
      expect(after.rows).toEqual(before.rows)
      throw new Rollback()
    })).rejects.toBeInstanceOf(Rollback)
  })
})
