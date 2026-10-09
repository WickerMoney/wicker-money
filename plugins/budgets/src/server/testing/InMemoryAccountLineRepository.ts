import { monthPeriod } from '../../shared/index.js'
import type { AccountLineRepository } from '../repository/AccountLineRepository.js'
import type { AccountLineRow } from '../repository/AccountLineRow.js'
import type { ExportedAccountLine } from '../repository/ExportedAccountLine.js'
import type { NewAccountLine } from '../repository/NewAccountLine.js'
import type { InMemoryBudgetStore } from './InMemoryBudgetStore.js'
import type { StoredAccountLine } from './StoredAccountLine.js'

/** {@link AccountLineRepository} over an {@link InMemoryBudgetStore}, narrowed to one user. */
export class InMemoryAccountLineRepository implements AccountLineRepository {
  /**
   * @param store - The shared data.
   * @param userId - The user whose rows this repository can see.
   */
  constructor(
    private readonly store: InMemoryBudgetStore,
    private readonly userId: string,
  ) {}

  /** @inheritdoc */
  async listForMonth(monthKey: string): Promise<AccountLineRow[]> {
    const { start, end } = monthPeriod(monthKey)
    return this.mine()
      .filter((l) => l.period_start === start && l.period_end === end)
      .sort((a, b) => a.account_id.localeCompare(b.account_id))
      .map(toRow)
  }

  /** @inheritdoc */
  async upsert(line: NewAccountLine): Promise<AccountLineRow | undefined> {
    this.store.writes++
    const existing = this.mine().find(
      (l) => l.account_id === line.accountId && l.period_start === line.periodStart,
    )
    const saved: StoredAccountLine = {
      id: existing?.id ?? this.store.newId(),
      userId: this.userId,
      account_id: line.accountId,
      period_start: line.periodStart,
      period_end: line.periodEnd,
      planned: line.planned,
      rollover: line.rollover,
      excluded_category_ids: [...line.excludedCategoryIds],
      note: line.note,
    }
    this.store.accountLines = this.store.accountLines.filter((l) => l !== existing).concat(saved)
    return toRow(saved)
  }

  /** @inheritdoc */
  async copyMonth(sourceMonth: string, targetMonth: string): Promise<number> {
    this.store.writes++
    const source = monthPeriod(sourceMonth)
    const target = monthPeriod(targetMonth)
    let created = 0
    for (const l of this.mine().filter((x) => x.period_start === source.start && x.period_end === source.end)) {
      if (this.mine().some((x) => x.account_id === l.account_id && x.period_start === target.start)) continue
      this.store.accountLines.push({
        ...l, id: this.store.newId(), period_start: target.start, period_end: target.end,
      })
      created++
    }
    return created
  }

  /** @inheritdoc */
  async deleteForMonth(accountId: string, monthKey: string): Promise<number> {
    this.store.writes++
    const { start, end } = monthPeriod(monthKey)
    const before = this.store.accountLines.length
    this.store.accountLines = this.store.accountLines.filter(
      (l) => !(l.userId === this.userId && l.account_id === accountId && l.period_start === start && l.period_end === end),
    )
    return before - this.store.accountLines.length
  }

  /** @inheritdoc */
  async listAll(): Promise<ExportedAccountLine[]> {
    return this.mine()
      .sort((a, b) => a.period_start.localeCompare(b.period_start) || a.account_id.localeCompare(b.account_id))
      .map((l) => ({
        ...toRow(l), period_end: l.period_end, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      }))
  }

  /** @returns This user's stored lines. */
  private mine(): StoredAccountLine[] {
    return this.store.accountLines.filter((l) => l.userId === this.userId)
  }
}

/** Drops the in-memory bookkeeping a repository's caller never sees. */
function toRow(l: StoredAccountLine): AccountLineRow {
  const { id, account_id, period_start, planned, rollover, excluded_category_ids, note } = l
  return { id, account_id, period_start, planned, rollover, excluded_category_ids, note }
}
