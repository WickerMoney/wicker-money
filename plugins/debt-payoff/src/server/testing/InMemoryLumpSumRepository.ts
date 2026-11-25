import type { ExportedLumpSum } from '../repository/ExportedLumpSum.js'
import type { LumpSumRepository } from '../repository/LumpSumRepository.js'
import type { LumpSumRow } from '../repository/LumpSumRow.js'
import type { NewLumpSum } from '../repository/NewLumpSum.js'
import type { InMemoryDebtStore, StoredLumpSum } from './InMemoryDebtStore.js'

const row = (l: StoredLumpSum): LumpSumRow => ({
  id: l.id, on_date: l.on_date, amount: l.amount, note: l.note,
  allocations: [...l.allocations].sort((a, b) => a.debt_id.localeCompare(b.debt_id)).map((a) => ({ ...a })),
})

/** {@link LumpSumRepository} over an {@link InMemoryDebtStore}, scoped to one user the way row-level security is. */
export class InMemoryLumpSumRepository implements LumpSumRepository {
  constructor(private readonly store: InMemoryDebtStore, private readonly userId: string) {}

  private mine(): StoredLumpSum[] {
    return this.store.lumpSums.filter((l) => l.userId === this.userId)
  }

  async list(): Promise<LumpSumRow[]> {
    return this.mine()
      .sort((a, b) => a.on_date.localeCompare(b.on_date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(row)
  }

  async find(id: string): Promise<LumpSumRow | undefined> {
    const found = this.mine().find((l) => l.id === id)
    return found === undefined ? undefined : row(found)
  }

  async count(): Promise<number> {
    return this.mine().length
  }

  async insert(lumpSum: NewLumpSum): Promise<LumpSumRow> {
    const stored: StoredLumpSum = {
      id: this.store.newId(), userId: this.userId, createdAt: this.store.tick(),
      on_date: lumpSum.onDate, amount: lumpSum.amount, note: lumpSum.note,
      allocations: lumpSum.allocations.map((a) => ({ debt_id: a.debtId, amount: a.amount })),
    }
    this.store.lumpSums.push(stored)
    return row(stored)
  }

  async replace(id: string, lumpSum: NewLumpSum): Promise<LumpSumRow | undefined> {
    const found = this.mine().find((l) => l.id === id)
    if (found === undefined) return undefined
    Object.assign(found, {
      on_date: lumpSum.onDate, amount: lumpSum.amount, note: lumpSum.note,
      allocations: lumpSum.allocations.map((a) => ({ debt_id: a.debtId, amount: a.amount })),
    })
    return row(found)
  }

  async delete(id: string): Promise<number> {
    const at = this.store.lumpSums.findIndex((l) => l.userId === this.userId && l.id === id)
    if (at < 0) return 0
    this.store.lumpSums.splice(at, 1)
    return 1
  }

  async listAll(): Promise<ExportedLumpSum[]> {
    const now = new Date(0)
    return (await this.list()).map((l) => ({ ...l, created_at: now, updated_at: now }))
  }
}
