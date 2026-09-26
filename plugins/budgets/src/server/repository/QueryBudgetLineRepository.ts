import { monthPeriod } from '../../shared/index.js'
import type { BudgetLineRepository } from './BudgetLineRepository.js'
import type { BudgetLineRow } from './BudgetLineRow.js'
import type { ExportedBudgetLine } from './ExportedBudgetLine.js'
import type { NewBudgetLine } from './NewBudgetLine.js'
import type { Query } from './Query.js'
import type { SavedBudgetLine } from './SavedBudgetLine.js'

/** {@link BudgetLineRepository} over a user-bound query runner. */
export class QueryBudgetLineRepository implements BudgetLineRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  listForMonth(monthKey: string): Promise<BudgetLineRow[]> {
    const { start } = monthPeriod(monthKey)
    return this.q<BudgetLineRow>`
      SELECT id, category_id, period_start::text, planned::text, rollover, note
      FROM plugin_budgets.budget_lines
      WHERE period_start = ${start}::date
      ORDER BY category_id
    `
  }

  /** @inheritdoc */
  async upsert(line: NewBudgetLine): Promise<SavedBudgetLine | undefined> {
    const rows = await this.q<SavedBudgetLine>`
      INSERT INTO plugin_budgets.budget_lines
        (user_id, category_id, period_start, period_end, planned, rollover, note)
      VALUES (
        core.current_user_id(), ${line.categoryId}, ${line.periodStart}::date, ${line.periodEnd}::date,
        ${line.planned}::numeric, ${line.rollover}, ${line.note}
      )
      ON CONFLICT (user_id, category_id, period_start) DO UPDATE
        SET planned = EXCLUDED.planned,
            rollover = EXCLUDED.rollover,
            note = EXCLUDED.note,
            updated_at = now()
      RETURNING id, category_id, period_start::text, planned::text, rollover, note
    `
    return rows[0]
  }

  /** @inheritdoc */
  async copyMonth(sourceMonth: string, targetMonth: string): Promise<number> {
    const source = monthPeriod(sourceMonth)
    const target = monthPeriod(targetMonth)
    // One statement rather than a loop: the whole month is one decision, and a
    // partial copy left behind by a mid-loop failure is a month whose plan is
    // quietly half of what the user agreed to. The plugin's own role and RLS
    // confine the SELECT to this user's rows, and the composite foreign key
    // makes a category from anyone else impossible regardless.
    const created = await this.q<{ id: string }>`
      INSERT INTO plugin_budgets.budget_lines
        (user_id, category_id, period_start, period_end, planned, rollover, note)
      SELECT user_id, category_id, ${target.start}::date, ${target.end}::date, planned, rollover, note
      FROM plugin_budgets.budget_lines
      WHERE period_start = ${source.start}::date
      ON CONFLICT (user_id, category_id, period_start) DO NOTHING
      RETURNING id
    `
    return created.length
  }

  /** @inheritdoc */
  async deleteForMonth(categoryId: string, monthKey: string): Promise<number> {
    const { start } = monthPeriod(monthKey)
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_budgets.budget_lines
      WHERE category_id = ${categoryId}
        AND period_start = ${start}::date
      RETURNING id
    `
    return gone.length
  }

  /** @inheritdoc */
  listAll(): Promise<ExportedBudgetLine[]> {
    return this.q<ExportedBudgetLine>`
      SELECT id, category_id, period_start, period_end, planned, rollover, note,
             created_at, updated_at
      FROM plugin_budgets.budget_lines
      ORDER BY period_start, category_id
    `
  }
}
