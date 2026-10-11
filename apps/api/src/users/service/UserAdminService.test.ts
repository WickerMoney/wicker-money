import { describe, expect, it, vi } from 'vitest'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { UserRole } from '../../db/models/index.js'
import { OwnerRequiredError } from '../../auth/OwnerRequiredError.js'
import type { ManagedUser } from '../repository/ManagedUser.js'
import type { UserAdminRepository } from '../repository/UserAdminRepository.js'
import { UserAdminService } from './UserAdminService.js'

const when = new Date('2026-10-01T12:00:00Z')
const user = (id: string, role: UserRole): ManagedUser => ({ id, email: `${id}@example.com`, role, createdAt: when })

/** A unit of work that records who it was bound to and which options it was given. */
function harness(repo: UserAdminRepository) {
  const forUser = vi.fn(<T>(_userId: string, work: (repos: Repositories) => Promise<T>, _options?: unknown) =>
    work({ userAdmin: repo } as unknown as Repositories))
  const uow = { forUser, forSystem: vi.fn() } as unknown as UnitOfWork
  return { service: new UserAdminService(uow), forUser }
}

describe('list', () => {
  it('runs as the caller, read-only, and returns what the repository found', async () => {
    const accounts = [user('a', 'owner'), user('b', 'member')]
    const { service, forUser } = harness({ list: () => Promise.resolve(accounts), setRole: vi.fn() })
    expect(await service.list('caller')).toEqual(accounts)
    expect(forUser).toHaveBeenCalledWith('caller', expect.any(Function), { readOnly: true })
  })

  it('lets a refusal from the database reach the caller', async () => {
    const { service } = harness({ list: () => Promise.reject(new OwnerRequiredError()), setRole: vi.fn() })
    await expect(service.list('member')).rejects.toBeInstanceOf(OwnerRequiredError)
  })
})

describe('setRole', () => {
  it('runs as the caller, in a writing transaction at the default isolation level', async () => {
    const setRole = vi.fn(() => Promise.resolve({ user: user('b', 'owner'), previousRole: 'member' as UserRole }))
    const { service, forUser } = harness({ list: vi.fn(), setRole })
    await service.setRole('caller', 'b', 'owner')
    expect(setRole).toHaveBeenCalledWith('b', 'owner')
    // No options: the database function refuses anything above READ COMMITTED, and refuses read-only writes.
    expect(forUser).toHaveBeenCalledWith('caller', expect.any(Function))
  })

  it('reports a change when the role differs from the previous one', async () => {
    const { service } = harness({
      list: vi.fn(),
      setRole: () => Promise.resolve({ user: user('b', 'owner'), previousRole: 'member' }),
    })
    expect(await service.setRole('caller', 'b', 'owner')).toEqual({ user: user('b', 'owner'), previousRole: 'member', changed: true })
  })

  it('reports no change when the account already had the role', async () => {
    const { service } = harness({
      list: vi.fn(),
      setRole: () => Promise.resolve({ user: user('b', 'member'), previousRole: 'member' }),
    })
    expect((await service.setRole('caller', 'b', 'member')).changed).toBe(false)
  })

  it('lets the database\'s refusals through unchanged', async () => {
    const { service } = harness({ list: vi.fn(), setRole: () => Promise.reject(new OwnerRequiredError()) })
    await expect(service.setRole('caller', 'b', 'owner')).rejects.toBeInstanceOf(OwnerRequiredError)
  })
})
