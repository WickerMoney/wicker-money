import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceMapping } from '../../shared/index.js'
import type { ImportRepositories } from '../repository/ImportRepositories.js'
import type { ImportUnitOfWork } from '../repository/ImportUnitOfWork.js'
import { InMemoryImportStore } from '../testing/InMemoryImportStore.js'
import { InMemoryImportUnitOfWork } from '../testing/InMemoryImportUnitOfWork.js'
import { ImportBusyError } from './ImportBusyError.js'
import { ImportGate } from './ImportGate.js'
import { ImportService } from './ImportService.js'

const MAPPING: SourceMapping = {
  sourceName: 'Test Bank',
  columns: { date: 'Date', merchant: 'Description', amount: 'Amount', externalId: 'Id' },
  dateFormat: 'MM/DD/YYYY',
  amountStyle: 'signed',
  invertAmount: false,
}
const csv = (tag: string) => `Date,Description,Amount,Id\n03/04/2026,COFFEE ${tag},-4.50,${tag}-1`
const commitInput = (tag: string) => ({
  accountId: 'acct', csv: csv(tag), mapping: MAPPING, fileName: `${tag}.csv`, acceptRowNumbers: [] as number[],
})

/**
 * A unit of work that counts the transactions open now and at most, and holds
 * each one until released, standing in for a pooled connection held through a
 * long write.
 */
class HeldUnitOfWork implements ImportUnitOfWork {
  open = 0
  opened = 0
  peak = 0
  private readonly releases: Array<() => void> = []
  constructor(private readonly inner: ImportUnitOfWork) {}

  async run<T>(userId: string, work: (repos: ImportRepositories) => Promise<T>): Promise<T> {
    this.open += 1
    this.opened += 1
    this.peak = Math.max(this.peak, this.open)
    try {
      await new Promise<void>((resolve) => this.releases.push(resolve))
      return await this.inner.run(userId, work)
    } finally {
      this.open -= 1
    }
  }

  /** Lets the longest-held transaction proceed. */
  releaseOne(): void { this.releases.shift()?.() }
}

let store: InMemoryImportStore
let uow: HeldUnitOfWork

const service = (gate: ImportGate | undefined) =>
  new ImportService(uow, () => null, 100, gate === undefined ? {} : { commit: gate })

beforeEach(() => {
  vi.useFakeTimers()
  store = new InMemoryImportStore()
  store.accounts.set('acct', 'user')
  uow = new HeldUnitOfWork(new InMemoryImportUnitOfWork(store))
})
afterEach(() => { vi.useRealTimers() })

describe('commit gate', () => {
  it('opens no transaction for a commit that is still waiting for its turn', async () => {
    const svc = service(new ImportGate(2, 60_000))
    const commits = ['a', 'b', 'c', 'd', 'e'].map((tag) => svc.commit('user', commitInput(tag)))
    await vi.advanceTimersByTimeAsync(0)
    expect(uow.opened).toBe(2)
    expect(uow.open).toBe(2)

    uow.releaseOne()
    await vi.advanceTimersByTimeAsync(0)
    expect(uow.opened).toBe(3)
    for (let i = 0; i < 4; i += 1) {
      uow.releaseOne()
      await vi.advanceTimersByTimeAsync(0)
    }
    await expect(Promise.all(commits)).resolves.toHaveLength(5)
    expect(uow.peak).toBe(2)
    expect(store.batches).toHaveLength(5)
  })

  it('refuses a commit that waited too long without opening a transaction or writing', async () => {
    const svc = service(new ImportGate(1, 5_000))
    const first = svc.commit('user', commitInput('a'))
    const second = svc.commit('user', commitInput('b')).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await second).toBeInstanceOf(ImportBusyError)
    expect(uow.opened).toBe(1)
    uow.releaseOne()
    await first
    expect(store.batches).toHaveLength(1)
  })

  it('does not limit commits when no gate is given', async () => {
    const svc = service(undefined)
    const commits = ['a', 'b', 'c'].map((tag) => svc.commit('user', commitInput(tag)))
    await vi.advanceTimersByTimeAsync(0)
    expect(uow.peak).toBe(3)
    for (let i = 0; i < 3; i += 1) uow.releaseOne()
    await Promise.all(commits)
  })

  it('leaves analyze outside the commit gate', async () => {
    const svc = service(new ImportGate(1, 60_000))
    const commit = svc.commit('user', commitInput('a'))
    const analysis = svc.analyze('user', { accountId: 'acct', csv: csv('z'), mapping: MAPPING })
    await vi.advanceTimersByTimeAsync(0)
    expect(uow.opened).toBe(2)
    uow.releaseOne()
    uow.releaseOne()
    await Promise.all([commit, analysis])
  })
})
