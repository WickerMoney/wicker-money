import { describe, expect, it, vi } from 'vitest'
import { DuplicateKeyError } from '../../data/DuplicateKeyError.js'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { AppError } from '../../errors.js'
import type { TransactionUndoRepository } from '../repository/TransactionUndoRepository.js'
import type { UndoSnapshotState } from '../repository/UndoSnapshotState.js'
import { TransactionService } from './TransactionService.js'
import { TransactionUndoService } from './TransactionUndoService.js'
import { InMemoryUnitOfWork } from './testing/InMemoryUnitOfWork.js'

const COUNTS = { restored: 1, relinkedMatch: false, restoredDismissals: 0, skippedDismissals: 0 }

/** A repository whose every method is a spy, with a locked snapshot in the given state. */
function fakeUndos(state: Partial<UndoSnapshotState> | undefined, over: Partial<TransactionUndoRepository> = {}) {
  const calls: string[] = []
  const track = <T>(name: string, value: T) => vi.fn((..._args: unknown[]) => { calls.push(name); return Promise.resolve(value) })
  const repo = {
    capture: track('capture', undefined),
    purgeExpired: track('purgeExpired', 0),
    enforceCap: track('enforceCap', 0),
    lock: track('lock', state === undefined ? undefined : { id: 's', kind: 'transaction', restored: false, expired: false, ...state }),
    missingReferences: track('missingReferences', { accounts: 0, categories: 0 }),
    externalIdTaken: track('externalIdTaken', false),
    restore: track('restore', COUNTS),
    purgeAllExpired: track('purgeAllExpired', 3),
    ...over,
  } as unknown as TransactionUndoRepository
  return { repo, calls }
}

function uowOf(repo: TransactionUndoRepository): { uow: UnitOfWork; forUser: ReturnType<typeof vi.fn>; forSystem: ReturnType<typeof vi.fn> } {
  const forUser = vi.fn((_id: string, work: (r: Repositories) => Promise<unknown>) => work({ transactionUndos: repo } as unknown as Repositories))
  const forSystem = vi.fn((work: (r: Repositories) => Promise<unknown>) => work({ transactionUndos: repo } as unknown as Repositories))
  return { uow: { forUser, forSystem } as unknown as UnitOfWork, forUser, forSystem }
}

const fails = async (p: Promise<unknown>): Promise<AppError> => {
  try {
    await p
  } catch (error) {
    return error as AppError
  }
  throw new Error('expected a refusal')
}

describe('TransactionUndoService.restore', () => {
  it('answers 404 not_found without opening a transaction when Undo is off', async () => {
    const { repo } = fakeUndos({})
    const { uow, forUser } = uowOf(repo)
    const error = await fails(new TransactionUndoService(uow, { undoTtlSeconds: 0 }).restore('u', 's'))
    expect([error.statusCode, error.code]).toEqual([404, 'not_found'])
    expect(forUser).not.toHaveBeenCalled()
    expect((await fails(new TransactionUndoService(uow).restore('u', 's'))).statusCode).toBe(404)
  })

  it('answers the same 404 for a snapshot that is not there as for one that is off', async () => {
    const { repo } = fakeUndos(undefined)
    const error = await fails(new TransactionUndoService(uowOf(repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))
    expect([error.statusCode, error.code]).toEqual([404, 'not_found'])
  })

  it('checks "already undone" before "expired", and refuses both without purging or restoring', async () => {
    const both = fakeUndos({ restored: true, expired: true })
    const error = await fails(new TransactionUndoService(uowOf(both.repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))
    expect([error.statusCode, error.code]).toEqual([409, 'already_undone'])
    const expired = fakeUndos({ expired: true })
    const gone = await fails(new TransactionUndoService(uowOf(expired.repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))
    expect([gone.statusCode, gone.code, gone.message]).toEqual([410, 'undo_expired', 'It is too late to undo that.'])
    for (const { calls } of [both, expired]) expect(calls).toEqual(['lock'])
  })

  it('names what is gone in a 409 undo_unavailable and does not insert', async () => {
    const cases: Array<[number, number, RegExp]> = [[1, 0, /an account it used/], [0, 2, /a category it used/], [1, 1, /an account and a category/]]
    for (const [accounts, categories, text] of cases) {
      const { repo, calls } = fakeUndos({}, { missingReferences: vi.fn(() => Promise.resolve({ accounts, categories })) })
      const error = await fails(new TransactionUndoService(uowOf(repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))
      expect([error.statusCode, error.code]).toEqual([409, 'undo_unavailable'])
      expect(error.message).toMatch(text)
      expect(calls).not.toContain('restore')
    }
  })

  it('answers 409 undo_conflict for a taken external id, before and during the insert', async () => {
    const before = fakeUndos({}, { externalIdTaken: vi.fn(() => Promise.resolve(true)) })
    expect((await fails(new TransactionUndoService(uowOf(before.repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))).code).toBe('undo_conflict')
    expect(before.calls).not.toContain('restore')
    const during = fakeUndos({}, { restore: vi.fn(() => Promise.reject(new DuplicateKeyError('ux_transactions_account_external_id'))) })
    const error = await fails(new TransactionUndoService(uowOf(during.repo).uow, { undoTtlSeconds: 600 }).restore('u', 's'))
    expect([error.statusCode, error.code]).toEqual([409, 'undo_conflict'])
    expect(during.calls).not.toContain('purgeExpired')
  })

  it('passes any other failure through unchanged, so the unit of work rolls back', async () => {
    const boom = new Error('boom')
    const { repo } = fakeUndos({}, { restore: vi.fn(() => Promise.reject(boom)) })
    await expect(new TransactionUndoService(uowOf(repo).uow, { undoTtlSeconds: 600 }).restore('u', 's')).rejects.toBe(boom)
  })

  it('on success locks first, restores, then purges the others and enforces the cap', async () => {
    const { repo, calls } = fakeUndos({})
    const result = await new TransactionUndoService(uowOf(repo).uow, { undoTtlSeconds: 600 }).restore('u', 's')
    expect(result).toEqual(COUNTS)
    expect(calls).toEqual(['lock', 'missingReferences', 'externalIdTaken', 'restore', 'purgeExpired', 'enforceCap'])
    expect(repo.purgeExpired).toHaveBeenCalledWith('s')
  })
})

describe('TransactionUndoService.purgeExpired', () => {
  it('runs without a user, through the system unit of work', async () => {
    const { repo } = fakeUndos({})
    const { uow, forUser, forSystem } = uowOf(repo)
    expect(await new TransactionUndoService(uow, { undoTtlSeconds: 0 }).purgeExpired()).toBe(3)
    expect(forSystem).toHaveBeenCalledTimes(1)
    expect(forUser).not.toHaveBeenCalled()
  })
})

describe('TransactionService.remove', () => {
  const ALICE = 'user-alice'

  async function ledger() {
    const uow = new InMemoryUnitOfWork()
    uow.ledger.accounts.push({ id: 'acc', userId: ALICE, name: 'Checking' })
    const service = new TransactionService(uow)
    const row = await service.create(ALICE, { accountId: 'acc', amount: '-1.00', merchant: 'x', transactionDate: '2026-03-01' })
    return { uow, row }
  }

  it('answers null, and never touches the snapshot repository, without the flag or with Undo off', async () => {
    const { uow, row } = await ledger()
    const service = new TransactionService(uow, { undoTtlSeconds: 600 })
    // The in-memory unit of work has no `transactionUndos`: reaching for it would throw.
    expect(await service.remove(ALICE, row.id)).toBeNull()
    const second = await new TransactionService(uow).create(ALICE, { accountId: 'acc', amount: '-2.00', merchant: 'y', transactionDate: '2026-03-01' })
    expect(await new TransactionService(uow, { undoTtlSeconds: 0 }).remove(ALICE, second.id, { undo: true })).toBeNull()
    expect(uow.ledger.transactions).toHaveLength(0)
  })

  it('writes the snapshot before the delete, after purging, then caps, and never fails the delete for a missing snapshot', async () => {
    const order: string[] = []
    const snapshot = { id: 's1', kind: 'transaction' as const, expiresAt: new Date('2030-01-01T00:00:00Z') }
    const undos = {
      purgeExpired: vi.fn(() => { order.push('purge'); return Promise.resolve(0) }),
      capture: vi.fn(() => { order.push('capture'); return Promise.resolve(snapshot) }),
      enforceCap: vi.fn(() => { order.push('cap'); return Promise.resolve(0) }),
    }
    const inner = new InMemoryUnitOfWork()
    inner.ledger.accounts.push({ id: 'acc', userId: ALICE, name: 'Checking' })
    const seeded = await new TransactionService(inner).create(ALICE, { accountId: 'acc', amount: '-1.00', merchant: 'x', transactionDate: '2026-03-01' })
    const uow = {
      forUser: (id: string, work: (r: Repositories) => Promise<unknown>) =>
        inner.forUser(id, (repos) => work({
          ...repos,
          transactionUndos: undos,
          transactions: new Proxy(repos.transactions, {
            get: (target, prop, receiver) => {
              const value = Reflect.get(target, prop, receiver) as unknown
              if (prop !== 'delete' || typeof value !== 'function') return value
              return (...args: unknown[]) => { order.push('delete'); return (value as (...a: unknown[]) => unknown).apply(target, args) }
            },
          }),
        } as unknown as Repositories)),
      forSystem: () => Promise.reject(new Error('unused')),
    } as unknown as UnitOfWork
    const service = new TransactionService(uow, { undoTtlSeconds: 600 })
    expect(await service.remove(ALICE, seeded.id, { undo: true })).toEqual(snapshot)
    expect(order).toEqual(['purge', 'capture', 'cap', 'delete'])
    expect(undos.capture).toHaveBeenCalledWith({ userId: ALICE, kind: 'transaction', transactionIds: [seeded.id], ttlSeconds: 600 })

    // No snapshot written (over the cap): the delete still happens, and the cap is not enforced.
    const again = await new TransactionService(inner).create(ALICE, { accountId: 'acc', amount: '-3.00', merchant: 'z', transactionDate: '2026-03-01' })
    undos.capture.mockImplementationOnce((() => { order.push('capture'); return Promise.resolve(undefined) }) as never)
    order.length = 0
    expect(await service.remove(ALICE, again.id, { undo: true })).toBeNull()
    expect(order).toEqual(['purge', 'capture', 'delete'])
  })
})
