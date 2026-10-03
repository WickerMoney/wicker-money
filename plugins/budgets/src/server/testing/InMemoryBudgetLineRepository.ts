import { isCalendarMonth, monthPeriod } from '../../shared/index.js'
import type { BudgetLineRepository } from '../repository/BudgetLineRepository.js'
import type { BudgetLineRow } from '../repository/BudgetLineRow.js'
import type { ExportedBudgetLine } from '../repository/ExportedBudgetLine.js'
import type { NewBudgetLine } from '../repository/NewBudgetLine.js'
import type { NewWindow } from '../repository/NewWindow.js'
import type { SavedBudgetLine } from '../repository/SavedBudgetLine.js'
import type { WindowRow } from '../repository/WindowRow.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'
import type { StoredLine } from './StoredLine.js'

/** What PostgreSQL's exclusion constraint throws, as the service sees it. */
const OVERLAP = Object.assign(new Error('conflicting key value violates exclusion constraint'), { code: '23P01' })

/**
 * {@link BudgetLineRepository} over an {@link InMemoryBudgetStore}, narrowed to one user.
 *
 * It enforces the same "one line per category per day" rule as the database's
 * exclusion constraint, and refuses with the same error code, so the service's
 * handling of an overlap is tested without a database.
 */
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
    const { start, end } = monthPeriod(monthKey)
    return this.mine()
      .filter((l) => l.period_start === start && l.period_end === end)
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
    this.refuseOverlap(line.categoryId, line.periodStart, line.periodEnd, existing)
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
    const source = monthPeriod(sourceMonth)
    const target = monthPeriod(targetMonth)
    const taken = new Set(
      this.mine()
        .filter((l) => l.period_start < target.end && l.period_end > target.start)
        .map((l) => l.category_id),
    )
    const copies = this.mine()
      .filter((l) => l.period_start === source.start && l.period_end === source.end && !taken.has(l.category_id))
      .map((l): StoredLine => ({
        ...l, id: this.store.newId(), period_start: target.start, period_end: target.end,
      }))
    this.store.lines.push(...copies)
    return copies.length
  }

  /** @inheritdoc */
  async deleteForMonth(categoryId: string, monthKey: string): Promise<number> {
    this.store.writes++
    const { start, end } = monthPeriod(monthKey)
    const doomed = this.mine().filter(
      (l) => l.category_id === categoryId && l.period_start === start && l.period_end === end,
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

  /** @inheritdoc */
  async listWindows(monthKey: string): Promise<WindowRow[]> {
    const { start, end } = monthPeriod(monthKey)
    return this.windows()
      .filter((l) => l.period_start < end && l.period_end > start)
      .sort((a, b) => a.category_id.localeCompare(b.category_id) || a.period_start.localeCompare(b.period_start))
      .map(toWindowRow)
  }

  /** @inheritdoc */
  async insertWindow(window: NewWindow): Promise<WindowRow | undefined> {
    this.store.writes++
    this.refuseOverlap(window.categoryId, window.periodStart, window.periodEnd, undefined)
    const saved: StoredLine = {
      id: this.store.newId(),
      userId: this.userId,
      category_id: window.categoryId,
      period_start: window.periodStart,
      period_end: window.periodEnd,
      planned: window.planned,
      rollover: false,
      note: window.note,
    }
    this.store.lines.push(saved)
    return toWindowRow(saved)
  }

  /** @inheritdoc */
  async updateWindow(id: string, window: NewWindow): Promise<WindowRow | undefined> {
    this.store.writes++
    const existing = this.windows().find((l) => l.id === id)
    if (existing === undefined) return undefined
    this.refuseOverlap(window.categoryId, window.periodStart, window.periodEnd, existing)
    const saved: StoredLine = {
      ...existing,
      category_id: window.categoryId,
      period_start: window.periodStart,
      period_end: window.periodEnd,
      planned: window.planned,
      note: window.note,
    }
    this.store.lines = [...this.store.lines.filter((l) => l !== existing), saved]
    return toWindowRow(saved)
  }

  /** @inheritdoc */
  async deleteWindow(id: string): Promise<number> {
    this.store.writes++
    const doomed = this.windows().filter((l) => l.id === id)
    this.store.lines = this.store.lines.filter((l) => !doomed.includes(l))
    return doomed.length
  }

  /** Throws the exclusion-violation error if another of this user's lines for the category overlaps the period. */
  private refuseOverlap(categoryId: string, start: string, end: string, self: StoredLine | undefined): void {
    const clash = this.mine().some(
      (l) => l !== self && l.category_id === categoryId && l.period_start < end && l.period_end > start,
    )
    if (clash) throw OVERLAP
  }

  private mine(): StoredLine[] {
    return this.store.lines.filter((l) => l.userId === this.userId)
  }

  private windows(): StoredLine[] {
    return this.mine().filter((l) => !isCalendarMonth(l.period_start, l.period_end))
  }
}

/** Projects a stored line onto the window row shape. */
function toWindowRow(l: StoredLine): WindowRow {
  return {
    id: l.id, category_id: l.category_id, period_start: l.period_start, period_end: l.period_end,
    planned: l.planned, note: l.note,
  }
}
