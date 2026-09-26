import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, type Config } from '../config.js'
import { DuplicateKeyError } from '../data/DuplicateKeyError.js'
import type { Repositories } from '../data/Repositories.js'
import type { UnitOfWork } from '../data/UnitOfWork.js'
import { AppError, ConflictError, UnauthorizedError } from '../errors.js'
import type { LoginCandidate } from './repository/LoginCandidate.js'
import type { NewRefreshToken } from './repository/NewRefreshToken.js'
import type { NewSession } from './repository/NewSession.js'
import type { RotatedSession } from './repository/RotatedSession.js'
import type { SessionRepository } from './repository/SessionRepository.js'
import type { UserRepository } from './repository/UserRepository.js'
import { AuthService } from './service.js'
import { hashRefreshToken } from './tokens.js'

// Real Argon2 is deliberately slow; these tests are about rotation logic.
vi.mock('./password.js', () => ({
  hashPassword: (plain: string) => Promise.resolve(`hashed:${plain}`),
  verifyPassword: (digest: string, plain: string) => Promise.resolve(digest === `hashed:${plain}`),
}))

/** One stored session row. */
interface Row {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
}

/** In-memory stand-in for the users and sessions tables. Every method runs to completion synchronously, as one atomic statement would. */
class Store {
  users: LoginCandidate[] = []
  sessions: Row[] = []
  purges: number[] = []

  private active(row: Row): boolean {
    return row.revokedAt === null && row.expiresAt.getTime() > Date.now()
  }

  readonly usersRepo: UserRepository = {
    register: (email, passwordHash) => {
      if (this.users.some((u) => u.email === email)) {
        return Promise.reject(new DuplicateKeyError('ux_users_email', new Error('duplicate')))
      }
      const user = { id: randomUUID(), email, timezone: 'UTC', passwordHash }
      this.users.push(user)
      return Promise.resolve({ id: user.id, email, timezone: 'UTC' })
    },
    findForLogin: (email) => Promise.resolve(this.users.find((u) => u.email === email)),
    findPasswordHash: (userId) =>
      Promise.resolve(this.users.find((u) => u.id === userId)?.passwordHash),
    updatePasswordHash: (userId, passwordHash) => {
      const user = this.users.find((u) => u.id === userId)
      if (user !== undefined) user.passwordHash = passwordHash
      return Promise.resolve()
    },
  }

  readonly sessionsRepo: SessionRepository = {
    insert: (input: NewSession) => {
      const row: Row = {
        id: randomUUID(),
        userId: input.userId,
        familyId: randomUUID(),
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
      }
      this.sessions.push(row)
      return Promise.resolve({ id: row.id, familyId: row.familyId })
    },
    rotate: (tokenHash: string, next: NewRefreshToken): Promise<RotatedSession | undefined> => {
      const row = this.sessions.find((s) => s.tokenHash === tokenHash && this.active(s))
      const user = this.users.find((u) => u.id === row?.userId)
      if (row === undefined || user === undefined) return Promise.resolve(undefined)
      row.revokedAt = new Date()
      this.sessions.push({
        id: randomUUID(),
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: next.tokenHash,
        expiresAt: next.expiresAt,
        revokedAt: null,
      })
      return Promise.resolve({
        sessionId: row.id,
        familyId: row.familyId,
        user: { id: user.id, email: user.email, timezone: user.timezone },
      })
    },
    revokeFamilyOf: (tokenHash) => {
      const family = this.sessions.find((s) => s.tokenHash === tokenHash)?.familyId
      if (family === undefined) return Promise.resolve(false)
      for (const s of this.sessions) if (s.familyId === family && s.revokedAt === null) s.revokedAt = new Date()
      return Promise.resolve(true)
    },
    revokeAllForUser: (userId) => {
      for (const s of this.sessions) if (s.userId === userId && s.revokedAt === null) s.revokedAt = new Date()
      return Promise.resolve()
    },
    isFamilyActive: (familyId) =>
      Promise.resolve(this.sessions.some((s) => s.familyId === familyId && this.active(s))),
    purgeDead: (retainSeconds) => {
      this.purges.push(retainSeconds)
      return Promise.resolve(0)
    },
  }

  /** The unit of work over this store; ignores the user context, which is a database concern. */
  readonly uow: UnitOfWork = {
    forUser: (_userId, work) => work(this.repositories()),
    forSystem: (work) => work(this.repositories()),
  }

  private repositories(): Repositories {
    // Only the two aggregates the service touches exist; the cast keeps the fake small.
    return { users: this.usersRepo, sessions: this.sessionsRepo } as unknown as Repositories
  }
}

const PASSWORD = 'correct-horse-battery-staple'

/** Builds a config that differs from the defaults only where `overrides` say so. */
function config(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused',
      AUTH_SECRET: 'test-secret-that-is-comfortably-long-enough-32',
    } as NodeJS.ProcessEnv),
    ...overrides,
  }
}

let store: Store
let service: AuthService

beforeEach(() => {
  store = new Store()
  service = new AuthService(store.uow, config())
})

describe('AuthService rotation', () => {
  it('rotates within one family: the presented token is spent and a successor is live', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    const second = await service.refresh(first.refreshToken)

    expect(second.refreshToken).not.toBe(first.refreshToken)
    const [original, successor] = store.sessions
    expect(original?.revokedAt).not.toBeNull()
    expect(successor?.revokedAt).toBeNull()
    expect(successor?.familyId).toBe(original?.familyId)
    expect(store.sessions).toHaveLength(2)
  })

  it('stores only the hash of a refresh token', async () => {
    const session = await service.register('a@example.com', PASSWORD)
    expect(store.sessions[0]?.tokenHash).toBe(hashRefreshToken(session.refreshToken))
    expect(store.sessions.some((s) => s.tokenHash === session.refreshToken)).toBe(false)
  })

  it('treats a replayed token as theft and revokes the whole family, successor included', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    const second = await service.refresh(first.refreshToken)

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)

    expect(store.sessions.every((s) => s.revokedAt !== null)).toBe(true)
    await expect(service.refresh(second.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(await service.authenticate(second.accessToken)).toBeNull()
  })

  it('leaves other families of the same user untouched when one is revoked for reuse', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    const other = await service.login('a@example.com', PASSWORD)
    await service.refresh(first.refreshToken)
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)

    expect(await service.authenticate(other.accessToken)).not.toBeNull()
    await expect(service.refresh(other.refreshToken)).resolves.toBeDefined()
  })

  it('lets only one of several concurrent refreshes with the same token succeed', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.refresh(first.refreshToken)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4)
  })

  it('rejects an unknown token without creating anything', async () => {
    await expect(service.refresh('never-issued')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(store.sessions).toHaveLength(0)
  })

  it('rejects an expired token', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    store.sessions[0]!.expiresAt = new Date(Date.now() - 1000)
    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe('AuthService sessions and access tokens', () => {
  it('logout ends the family so its access tokens stop authenticating', async () => {
    const session = await service.register('a@example.com', PASSWORD)
    expect(await service.authenticate(session.accessToken)).toMatchObject({ email: 'a@example.com' })

    await service.logout(session.refreshToken)

    expect(await service.authenticate(session.accessToken)).toBeNull()
    await expect(service.refresh(session.refreshToken)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('logout with an unknown token is a no-op', async () => {
    await expect(service.logout('never-issued')).resolves.toBeUndefined()
  })

  it('an access token survives a rotation of its family', async () => {
    const first = await service.register('a@example.com', PASSWORD)
    await service.refresh(first.refreshToken)
    expect(await service.authenticate(first.accessToken)).not.toBeNull()
  })

  it('rejects garbage as an access token', async () => {
    expect(await service.authenticate('not.a.jwt')).toBeNull()
  })

  it('a password change revokes every session', async () => {
    const one = await service.register('a@example.com', PASSWORD)
    const two = await service.login('a@example.com', PASSWORD)
    const userId = one.user.id

    await service.changePassword(userId, PASSWORD, 'another-long-passphrase')

    expect(await service.authenticate(one.accessToken)).toBeNull()
    expect(await service.authenticate(two.accessToken)).toBeNull()
    await expect(service.login('a@example.com', PASSWORD)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(service.login('a@example.com', 'another-long-passphrase')).resolves.toBeDefined()
  })

  it('a password change with the wrong current password changes nothing', async () => {
    const one = await service.register('a@example.com', PASSWORD)
    await expect(
      service.changePassword(one.user.id, 'wrong-current-password', 'another-long-passphrase'),
    ).rejects.toBeInstanceOf(UnauthorizedError)
    expect(await service.authenticate(one.accessToken)).not.toBeNull()
  })
})

describe('AuthService accounts', () => {
  it('normalises the email on register, login and reset', async () => {
    const created = await service.register('  Mixed@Example.COM ', PASSWORD)
    expect(created.user.email).toBe('mixed@example.com')
    await expect(service.login('MIXED@example.com  ', PASSWORD)).resolves.toBeDefined()
    expect(await service.resetPassword(' Mixed@EXAMPLE.com', 'a-reset-passphrase')).toBe('mixed@example.com')
    await expect(service.login('mixed@example.com', 'a-reset-passphrase')).resolves.toBeDefined()
  })

  it('reports a duplicate email as a conflict with code email_taken', async () => {
    await service.register('a@example.com', PASSWORD)
    const error = await service.register('A@example.com', PASSWORD).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('email_taken')
  })

  it('refuses registration with 403 registration_disabled when switched off', async () => {
    const closed = new AuthService(store.uow, config({ REGISTRATION_ENABLED: false }))
    const error = await closed.register('a@example.com', PASSWORD).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AppError)
    expect(error).toMatchObject({ statusCode: 403, code: 'registration_disabled' })
    expect(store.users).toHaveLength(0)
  })

  it('answers unknown email and wrong password identically', async () => {
    await service.register('a@example.com', PASSWORD)
    const unknown = await service.login('nobody@example.com', PASSWORD).catch((e: unknown) => e)
    const wrong = await service.login('a@example.com', 'wrong-password-entirely').catch((e: unknown) => e)
    expect(unknown).toBeInstanceOf(UnauthorizedError)
    expect((unknown as Error).message).toBe((wrong as Error).message)
  })

  it('a reset for an unknown email reports nothing and revokes nothing', async () => {
    const session = await service.register('a@example.com', PASSWORD)
    expect(await service.resetPassword('nobody@example.com', 'a-reset-passphrase')).toBeUndefined()
    expect(await service.authenticate(session.accessToken)).not.toBeNull()
  })
})

describe('AuthService purging', () => {
  it('purges opportunistically on login, at most once per interval', async () => {
    await service.register('a@example.com', PASSWORD)
    await service.login('a@example.com', PASSWORD)
    await service.login('a@example.com', PASSWORD)
    expect(store.purges).toEqual([7 * 24 * 60 * 60])
  })

  it('never fails a login because the purge failed', async () => {
    await service.register('a@example.com', PASSWORD)
    store.sessionsRepo.purgeDead = () => Promise.reject(new Error('database busy'))
    await expect(service.login('a@example.com', PASSWORD)).resolves.toBeDefined()
  })
})
