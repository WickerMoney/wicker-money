import { monthPeriod } from '../../shared/index.js'
import type { BudgetLineRepository } from './BudgetLineRepository.js'
import type { BudgetLineRow } from './BudgetLineRow.js'
import type { ExportedBudgetLine } from './ExportedBudgetLine.js'
import type { NewBudgetLine } from './NewBudgetLine.js'
import type { NewWindow } from './NewWindow.js'
import type { Query } from './Query.js'
import type { SavedBudgetLine } from './SavedBudgetLine.js'
import type { WindowRow } from './WindowRow.js'

/**
 * {@link BudgetLineRepository} over a user-bound query runner.
 *
 * A monthly line is one whose period is exactly a calendar month; a window is
 * anything else. The month queries pin both ends of the period, so they match
 * monthly lines only. The window queries use the complement:
 *
 *     NOT (period_start = date_trunc('month', period_start)::date
 *          AND period_end = (period_start + interval '1 month')::date)
 *
 * The query runner only takes values as bound parameters, so that predicate is
 * repeated literally rather than spliced in.
 */
export class QueryBudgetLineRepository implements BudgetLineRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  listForMonth(monthKey: string): Promise<BudgetLineRow[]> {
    const { start, end } = monthPeriod(monthKey)
    return this.q<BudgetLineRow>`
      SELECT id, category_id, period_start::text, planned::text, rollover, note
      FROM plugin_budgets.budget_lines
      WHERE period_start = ${start}::date
        AND period_end = ${end}::date
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
      SELECT b.user_id, b.category_id, ${target.start}::date, ${target.end}::date, b.planned, b.rollover, b.note
      FROM plugin_budgets.budget_lines b
      WHERE b.period_start = ${source.start}::date
        AND b.period_end = ${source.end}::date
        -- A category with a window over any part of the target month already has
        -- its money for those days. Copying a monthly line in would count that
        -- spending twice, and the exclusion constraint would refuse the whole
        -- statement rather than skip the one row, which ON CONFLICT cannot do.
        AND NOT EXISTS (
          SELECT 1 FROM plugin_budgets.budget_lines w
          WHERE w.category_id = b.category_id
            AND w.period_start < ${target.end}::date
            AND w.period_end > ${target.start}::date
        )
      ON CONFLICT (user_id, category_id, period_start) DO NOTHING
      RETURNING id
    `
    return created.length
  }

  /** @inheritdoc */
  async deleteForMonth(categoryId: string, monthKey: string): Promise<number> {
    const { start, end } = monthPeriod(monthKey)
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_budgets.budget_lines
      WHERE category_id = ${categoryId}
        AND period_start = ${start}::date
        AND period_end = ${end}::date
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

  /** @inheritdoc */
  listWindows(monthKey: string): Promise<WindowRow[]> {
    const { start, end } = monthPeriod(monthKey)
    return this.q<WindowRow>`
      SELECT id, category_id, period_start::text, period_end::text, planned::text, note
      FROM plugin_budgets.budget_lines
      WHERE period_start < ${end}::date
        AND period_end > ${start}::date
        AND NOT (period_start = date_trunc('month', period_start)::date
                 AND period_end = (period_start + interval '1 month')::date)
      ORDER BY category_id, period_start
    `
  }

  /** @inheritdoc */
  async insertWindow(window: NewWindow): Promise<WindowRow | undefined> {
    // A window never rolls over: it is the whole fund, and nothing follows it.
    const rows = await this.q<WindowRow>`
      INSERT INTO plugin_budgets.budget_lines
        (user_id, category_id, period_start, period_end, planned, rollover, note)
      VALUES (
        core.current_user_id(), ${window.categoryId}, ${window.periodStart}::date, ${window.periodEnd}::date,
        ${window.planned}::numeric, false, ${window.note}
      )
      RETURNING id, category_id, period_start::text, period_end::text, planned::text, note
    `
    return rows[0]
  }

  /** @inheritdoc */
  async updateWindow(id: string, window: NewWindow): Promise<WindowRow | undefined> {
    const rows = await this.q<WindowRow>`
      UPDATE plugin_budgets.budget_lines
      SET category_id = ${window.categoryId},
          period_start = ${window.periodStart}::date,
          period_end = ${window.periodEnd}::date,
          planned = ${window.planned}::numeric,
          note = ${window.note},
          updated_at = now()
      WHERE id = ${id}
        AND NOT (period_start = date_trunc('month', period_start)::date
                 AND period_end = (period_start + interval '1 month')::date)
      RETURNING id, category_id, period_start::text, period_end::text, planned::text, note
    `
    return rows[0]
  }

  /** @inheritdoc */
  async deleteWindow(id: string): Promise<number> {
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_budgets.budget_lines
      WHERE id = ${id}
        AND NOT (period_start = date_trunc('month', period_start)::date
                 AND period_end = (period_start + interval '1 month')::date)
      RETURNING id
    `
    return gone.length
  }
}
