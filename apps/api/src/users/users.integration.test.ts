import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, type Db } from '../db/client.js'
import {
  auth, createHarness, createUser, TEST_ADMIN_DATABASE_URL, type Harness, type TestUser,
} from '../testing/harness.js'
import { withOwners as withOwnersOn } from '../testing/withOwners.js'

/**
 * The owner role screen's API: `GET /api/v1/users` and
 * `PATCH /api/v1/users/:id/role`.
 *
 * The rules that matter most are the ones that protect the instance (a member
 * cannot promote themselves, the last owner cannot be demoted, two owners
 * demoting each other cannot leave none) and the ones that protect other
 * people (listing accounts exposes four fields and nothing of their data).
 */

let h: Harness
let admin: Db
let alice: TestUser
let bob: TestUser
let carol: TestUser
let member: TestUser
/** A second household, with ledger rows of its own, used to prove nothing leaks either way. */
let outsider: TestUser

const withOwners = (owners: TestUser[], fn: () => Promise<void>): Promise<void> => withOwnersOn(admin, owners, fn)

const list = (u: TestUser) => h.app.inject({ method: 'GET', url: '/api/v1/users', headers: auth(u) })
const setRole = (caller: TestUser, targetId: string, payload: unknown) =>
  h.app.inject({ method: 'PATCH', url: `/api/v1/users/${targetId}/role`, headers: auth(caller), payload })

interface UserBody { id: string; email: string; role: 'owner' | 'member'; createdAt: string }
interface ChangeBody {
  user: UserBody; previous: { role: string }; changed: boolean
  changedBy: { id: string; email: string }; changedAt: string
}

async function roleOf(id: string): Promise<string | undefined> {
  const { rows } = await sql<{ role: string }>`SELECT role::text AS role FROM core.users WHERE id = ${id}`.execute(admin)
  return rows[0]?.role
}

async function ownersAmong(users: TestUser[]): Promise<string[]> {
  const ids = users.map((u) => u.id)
  const { rows } = await sql<{ id: string }>`SELECT id FROM core.users WHERE id = ANY(${ids}::uuid[]) AND role = 'owner'`.execute(admin)
  return rows.map((r) => r.id)
}

async function createAccount(u: TestUser, name: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST', url: '/api/v1/accounts', headers: auth(u),
    payload: { name, accountType: 'checking', initialBalance: '10.0000', currencyCode: 'USD' },
  })
  expect(res.statusCode, res.body).toBe(201)
  return (res.json() as { id: string }).id
}

const accountNames = async (u: TestUser): Promise<string[]> => {
  const res = await h.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: auth(u) })
  expect(res.statusCode).toBe(200)
  return (res.json() as Array<{ name: string }>).map((a) => a.name).sort()
}

beforeAll(async () => {
  h = await createHarness()
  admin = createDb(TEST_ADMIN_DATABASE_URL)
  ;[alice, bob, carol, member, outsider] = await Promise.all([
    createUser(h), createUser(h), createUser(h), createUser(h), createUser(h),
  ])
})

afterAll(async () => {
  await admin.destroy()
  await h.close()
})

describe('who may call it', () => {
  it('refuses a member on both routes with 403 owner_required, and changes nothing', async () => {
    await withOwners([alice], async () => {
      const listed = await list(member)
      expect(listed.statusCode).toBe(403)
      expect(listed.json().code).toBe('owner_required')

      for (const target of [member.id, bob.id]) {
        const res = await setRole(member, target, { role: 'owner' })
        expect(res.statusCode, `member -> ${target}`).toBe(403)
        expect(res.json().code).toBe('owner_required')
      }
      expect(await roleOf(member.id)).toBe('member')
      expect(await roleOf(bob.id)).toBe('member')
    })
  })

  it('refuses a request with no token, or a bad one, with 401', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/users' })).statusCode).toBe(401)
    expect((await h.app.inject({ method: 'PATCH', url: `/api/v1/users/${bob.id}/role`, payload: { role: 'owner' } })).statusCode).toBe(401)
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401)
  })

  it('lets an owner list and change roles', async () => {
    await withOwners([alice], async () => {
      expect((await list(alice)).statusCode).toBe(200)
      expect((await setRole(alice, bob.id, { role: 'owner' })).statusCode).toBe(200)
    })
  })

  it('is decided at the database too: the owner functions refuse a member even if a route forgot to check', async () => {
    await withOwners([alice], async () => {
      const attempt = asUser(h.db, member.id, (trx) => sql`SELECT * FROM core.set_user_role(${member.id}::uuid, 'owner')`.execute(trx))
      await expect(attempt).rejects.toMatchObject({ code: '42501' })
      expect(await roleOf(member.id)).toBe('member')
    })
  })
})

describe('GET /api/v1/users', () => {
  it('lists every account with only id, email, role and creation time', async () => {
    await withOwners([alice], async () => {
      const res = await list(alice)
      const users = (res.json() as { users: UserBody[] }).users
      const ours = users.filter((u) => [alice, bob, carol, member, outsider].some((t) => t.id === u.id))
      expect(ours.map((u) => u.email).sort()).toEqual([alice, bob, carol, member, outsider].map((t) => t.email).sort())
      for (const u of users) {
        expect(Object.keys(u).sort()).toEqual(['createdAt', 'email', 'id', 'role'])
        expect(Number.isNaN(Date.parse(u.createdAt))).toBe(false)
      }
      expect(users.find((u) => u.id === alice.id)?.role).toBe('owner')
      expect(users.find((u) => u.id === member.id)?.role).toBe('member')
      expect(res.body).not.toMatch(/password|argon|\$argon2/i)
    })
  })

  it('orders accounts oldest first', async () => {
    await withOwners([alice], async () => {
      const users = ((await list(alice)).json() as { users: UserBody[] }).users
      const times = users.map((u) => Date.parse(u.createdAt))
      expect(times).toEqual([...times].sort((a, b) => a - b))
    })
  })
})

describe('PATCH /api/v1/users/:id/role', () => {
  it('promotes a member and says who did it and what the role was', async () => {
    await withOwners([alice], async () => {
      const res = await setRole(alice, bob.id, { role: 'owner' })
      expect(res.statusCode).toBe(200)
      const body = res.json() as ChangeBody
      expect(body).toMatchObject({
        user: { id: bob.id, email: bob.email, role: 'owner' },
        previous: { role: 'member' },
        changed: true,
        changedBy: { id: alice.id, email: alice.email },
      })
      expect(Object.keys(body.user).sort()).toEqual(['createdAt', 'email', 'id', 'role'])
      expect(Number.isNaN(Date.parse(body.changedAt))).toBe(false)
      expect(await roleOf(bob.id)).toBe('owner')
    })
  })

  it('is idempotent: asking for the role an account has changes nothing', async () => {
    await withOwners([alice, bob], async () => {
      const again = (await setRole(alice, bob.id, { role: 'owner' })).json() as ChangeBody
      expect(again).toMatchObject({ changed: false, previous: { role: 'owner' }, user: { role: 'owner' } })
      const member2 = (await setRole(alice, member.id, { role: 'member' })).json() as ChangeBody
      expect(member2).toMatchObject({ changed: false, previous: { role: 'member' } })
    })
  })

  it('takes effect on the demoted account\'s very next request, with the token it already holds', async () => {
    await withOwners([alice, bob], async () => {
      // Bob's token was issued while he was a member and has not been refreshed since.
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/plugins/registry', headers: auth(bob) })).statusCode).toBe(200)

      expect((await setRole(alice, bob.id, { role: 'member' })).statusCode).toBe(200)

      for (const res of [
        await h.app.inject({ method: 'GET', url: '/api/v1/plugins/registry', headers: auth(bob) }),
        await list(bob),
        await setRole(bob, bob.id, { role: 'owner' }),
      ]) {
        expect(res.statusCode).toBe(403)
        expect(res.json().code).toBe('owner_required')
      }
    })
  })

  it('takes effect on a promoted account\'s very next request too', async () => {
    await withOwners([alice], async () => {
      expect((await list(carol)).statusCode).toBe(403)
      await setRole(alice, carol.id, { role: 'owner' })
      expect((await list(carol)).statusCode).toBe(200)
      expect((await h.app.inject({ method: 'GET', url: '/api/v1/plugins/registry', headers: auth(carol) })).statusCode).toBe(200)
    })
  })

  it('leaves the affected account signed in, and /auth/me reports the new role', async () => {
    await withOwners([alice, bob], async () => {
      await setRole(alice, bob.id, { role: 'member' })
      const me = await h.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(bob) })
      expect(me.statusCode).toBe(200)
      expect(me.json()).toMatchObject({ id: bob.id, role: 'member' })
    })
  })

  it('lets a second owner demote the first', async () => {
    await withOwners([alice, bob], async () => {
      const res = await setRole(bob, alice.id, { role: 'member' })
      expect(res.statusCode).toBe(200)
      expect(await ownersAmong([alice, bob])).toEqual([bob.id])
    })
  })

  it('refuses to demote the last owner, even when they ask for themselves', async () => {
    await withOwners([alice], async () => {
      const res = await setRole(alice, alice.id, { role: 'member' })
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('last_owner')
      expect(await roleOf(alice.id)).toBe('owner')
      expect((await list(alice)).statusCode).toBe(200)
    })
  })

  it('lets an owner demote themselves while another owner remains, and then refuses them', async () => {
    await withOwners([alice, bob], async () => {
      const res = await setRole(alice, alice.id, { role: 'member' })
      expect(res.statusCode).toBe(200)
      expect((res.json() as ChangeBody).user.role).toBe('member')
      expect((await list(alice)).statusCode).toBe(403)
      // Bob is the last owner now.
      const last = await setRole(bob, bob.id, { role: 'member' })
      expect(last.statusCode).toBe(409)
      expect(await ownersAmong([alice, bob])).toEqual([bob.id])
    })
  })

  it('keeps one promotion from becoming a way around the rule: promote, demote the first, then try the second', async () => {
    await withOwners([alice], async () => {
      expect((await setRole(alice, bob.id, { role: 'owner' })).statusCode).toBe(200)
      expect((await setRole(bob, alice.id, { role: 'member' })).statusCode).toBe(200)
      expect((await setRole(bob, bob.id, { role: 'member' })).json().code).toBe('last_owner')
    })
  })

  it('answers 404 for an account that does not exist', async () => {
    await withOwners([alice], async () => {
      const res = await setRole(alice, '00000000-0000-4000-8000-000000000000', { role: 'owner' })
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('not_found')
    })
  })

  it('answers 400 with field issues for a bad id or body', async () => {
    await withOwners([alice], async () => {
      const badId = await h.app.inject({ method: 'PATCH', url: '/api/v1/users/not-a-uuid/role', headers: auth(alice), payload: { role: 'owner' } })
      expect(badId.statusCode).toBe(400)
      expect(badId.json().code).toBe('validation_failed')

      for (const payload of [{}, { role: 'admin' }, { role: 'OWNER' }, { role: 1 }, { role: 'owner', extra: true }]) {
        const res = await setRole(alice, bob.id, payload)
        expect(res.statusCode, JSON.stringify(payload)).toBe(400)
        expect(res.json().code).toBe('validation_failed')
        expect((res.json() as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
      }
      const noBody = await h.app.inject({ method: 'PATCH', url: `/api/v1/users/${bob.id}/role`, headers: auth(alice) })
      expect(noBody.statusCode).toBe(400)
      const wrongRole = (await setRole(alice, bob.id, { role: 'admin' })).json() as { issues: Array<{ path: string[]; message: string }> }
      expect(wrongRole.issues[0]).toMatchObject({ path: ['role'], message: 'Must be one of: owner, member.' })
      expect(await roleOf(bob.id)).toBe('member')
    })
  })
})

describe('two owners at once', () => {
  it('leaves exactly one owner when two owners demote each other simultaneously, over many rounds', async () => {
    for (let round = 0; round < 15; round += 1) {
      await withOwners([alice, bob], async () => {
        const [a, b] = await Promise.all([
          setRole(alice, bob.id, { role: 'member' }),
          setRole(bob, alice.id, { role: 'member' }),
        ])
        const statuses = [a.statusCode, b.statusCode].sort()
        expect(statuses, `round ${round}: ${a.body} / ${b.body}`).toContain(200)
        expect(await ownersAmong([alice, bob])).toHaveLength(1)
        // The loser is told why: it was demoted while it waited, or it would have removed the last owner.
        const loser = a.statusCode === 200 ? b : a
        expect([403, 409]).toContain(loser.statusCode)
        expect(['owner_required', 'last_owner']).toContain(loser.json().code)
      })
    }
  })

  it('keeps an owner when three owners demote one another in a ring', async () => {
    for (let round = 0; round < 8; round += 1) {
      await withOwners([alice, bob, carol], async () => {
        const results = await Promise.all([
          setRole(alice, bob.id, { role: 'member' }),
          setRole(bob, carol.id, { role: 'member' }),
          setRole(carol, alice.id, { role: 'member' }),
        ])
        const remaining = await ownersAmong([alice, bob, carol])
        expect(remaining.length, `round ${round}: ${results.map((r) => r.statusCode).join(',')}`).toBeGreaterThanOrEqual(1)
        expect(results.filter((r) => r.statusCode === 200).length + remaining.length).toBe(3)
        for (const r of results) expect([200, 403, 409]).toContain(r.statusCode)
      })
    }
  })

  it('does not let a simultaneous promotion and demotion strand the instance without an owner', async () => {
    await withOwners([alice], async () => {
      // Alice promotes Bob while Bob (a member at that instant) tries to demote Alice.
      const [promote, demote] = await Promise.all([
        setRole(alice, bob.id, { role: 'owner' }),
        setRole(bob, alice.id, { role: 'member' }),
      ])
      expect(promote.statusCode).toBe(200)
      expect([200, 403, 409]).toContain(demote.statusCode)
      expect((await ownersAmong([alice, bob])).length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('registration alongside role changes', () => {
  it('still registers newcomers as members after an owner promoted a second owner', async () => {
    await withOwners([alice], async () => {
      await setRole(alice, bob.id, { role: 'owner' })
      const newcomer = await createUser(h)
      expect(await roleOf(newcomer.id)).toBe('member')
    })
  })
})

describe('two households', () => {
  it('shows an owner other accounts\' emails and roles, but none of their data', async () => {
    const aliceAccount = await createAccount(alice, `Alice only ${alice.id.slice(0, 8)}`)
    const outsiderAccount = await createAccount(outsider, `Outsider only ${outsider.id.slice(0, 8)}`)
    expect(aliceAccount).not.toBe(outsiderAccount)

    await withOwners([alice], async () => {
      const users = ((await list(alice)).json() as { users: UserBody[] }).users
      expect(users.some((u) => u.id === outsider.id)).toBe(true)
      expect(await accountNames(alice)).toEqual([`Alice only ${alice.id.slice(0, 8)}`])
      expect(await accountNames(outsider)).toEqual([`Outsider only ${outsider.id.slice(0, 8)}`])

      // Making the outsider an owner gives them the instance, not Alice's ledger, and vice versa.
      await setRole(alice, outsider.id, { role: 'owner' })
      expect(await accountNames(outsider)).toEqual([`Outsider only ${outsider.id.slice(0, 8)}`])
      expect(await accountNames(alice)).toEqual([`Alice only ${alice.id.slice(0, 8)}`])
      const direct = await h.app.inject({ method: 'GET', url: `/api/v1/accounts/${aliceAccount}`, headers: auth(outsider) })
      expect(direct.statusCode).toBe(404)
    })
  })

  it('does not loosen row-level security: an owner still reads exactly one core.users row directly', async () => {
    await withOwners([alice], async () => {
      const rows = await asUser(h.db, alice.id, async (trx) =>
        (await sql<{ id: string }>`SELECT id FROM core.users`.execute(trx)).rows)
      expect(rows.map((r) => r.id)).toEqual([alice.id])
      const updated = await asUser(h.db, alice.id, async (trx) =>
        (await sql`UPDATE core.users SET updated_at = now() WHERE id = ${member.id}`.execute(trx)).numAffectedRows)
      expect(Number(updated)).toBe(0)
    })
  })

  it('refuses a member in one household from reaching another household\'s accounts list through this route', async () => {
    await withOwners([alice], async () => {
      // The previous test promoted the outsider; withOwners restored the real owners afterwards.
      expect(await roleOf(outsider.id)).toBe('member')
      const res = await list(outsider)
      expect(res.statusCode).toBe(403)
      expect(res.body).not.toContain(alice.email)
    })
  })
})
