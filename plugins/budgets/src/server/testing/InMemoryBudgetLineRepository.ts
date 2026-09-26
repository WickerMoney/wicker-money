import type { BudgetLineRepository } from '../repository/BudgetLineRepository.js'
import type { BudgetLineRow } from '../repository/BudgetLineRow.js'
import type { ExportedBudgetLine } from '../repository/ExportedBudgetLine.js'
import type { NewBudgetLine } from '../repository/NewBudgetLine.js'
import type { SavedBudgetLine } from '../repository/SavedBudgetLine.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'
import type { StoredLine } from './StoredLine.js'

/** {@link BudgetLineRepository} over an {@link InMemoryBudgetStore}, narrowed to one user. */
export class InMemoryBudgetLineRepository implements BudgetLineRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose rows this repository can see.
   */
  constructor(
    private readonly store: InMemoryBudgetStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async listForMonth(monthKey: string): Promise<BudgetLineRow[]> {
    return this.mine()
      .filter((l) => l.period_start === `${monthKey}-01`)
      .sort((a, b) => a.category_id.localeCompare(b.category_id))
      .map(({ id, category_id, period_start, planned, rollover, note }) => ({
        id, category_id, period_start, planned, rollover, note,
      }))
  }

  /** @inheritdoc */
  async upsert(line: NewBudgetLine): Promise<SavedBudgetLine | undefined> {
    this.store.writes++
    if (this.store.failNextUpsert) {
      this.store.failNextUpsert = false
      return undefined
    }
    const existing = this.mine().find(
      (l) => l.category_id === line.categoryId && l.period_start === line.periodStart,
    )
    const saved: StoredLine = {
      id: existing?.id ?? this.store.newId(),
      userId: this.userId,
      category_id: line.categoryId,
      period_start: line.periodStart,
      period_end: line.periodEnd,
      planned: line.planned,
      rollover: line.rollover,
      note: line.note,
    }
    this.store.lines = [...this.store.lines.filter((l) => l !== existing), saved]
    return {
      id: saved.id, category_id: saved.category_id, period_start: saved.period_start,
      planned: saved.planned, rollover: saved.rollover, note: saved.note,
    }
  }

  /** @inheritdoc */
  async copyMonth(sourceMonth: string, targetMonth: string): Promise<number> {
    this.store.writes++
    const taken = new Set(
      this.mine().filter((l) => l.period_start === `${targetMonth}-01`).map((l) => l.category_id),
    )
    const copies = this.mine()
      .filter((l) => l.period_start === `${sourceMonth}-01` && !taken.has(l.category_id))
      .map((l): StoredLine => ({
        ...l, id: this.store.newId(), period_start: `${targetMonth}-01`, period_end: `${targetMonth}-28`,
      }))
    this.store.lines.push(...copies)
    return copies.length
  }

  /** @inheritdoc */
  async deleteForMonth(categoryId: string, monthKey: string): Promise<number> {
    this.store.writes++
    const doomed = this.mine().filter(
      (l) => l.category_id === categoryId && l.period_start === `${monthKey}-01`,
    )
    this.store.lines = this.store.lines.filter((l) => !doomed.includes(l))
    return doomed.length
  }

  /** @inheritdoc */
  async listAll(): Promise<ExportedBudgetLine[]> {
    return this.mine().map((l) => ({
      id: l.id, category_id: l.category_id, period_start: l.period_start, period_end: l.period_end,
      planned: l.planned, rollover: l.rollover, note: l.note, created_at: '', updated_at: '',
    }))
  }

  private mine(): StoredLine[] {
    return this.store.lines.filter((l) => l.userId === this.userId)
  }
}
