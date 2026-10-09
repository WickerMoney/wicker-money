import { monthPeriod } from '../../shared/index.js'
import type { AccountLineRepository } from './AccountLineRepository.js'
import type { AccountLineRow } from './AccountLineRow.js'
import type { ExportedAccountLine } from './ExportedAccountLine.js'
import type { NewAccountLine } from './NewAccountLine.js'
import type { Query } from './Query.js'

/**
 * {@link AccountLineRepository} over a user-bound query runner.
 *
 * Account lines are always one calendar month, so unlike category lines there
 * is no window to tell apart: the month queries match on the two dates
 * exactly, and the table's CHECK keeps any other period out.
 */
export class QueryAccountLineRepository implements AccountLineRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  listForMonth(monthKey: string): Promise<AccountLineRow[]> {
    const { start, end } = monthPeriod(monthKey)
    return this.q<AccountLineRow>`
      SELECT id, account_id, period_start::text, planned::text, rollover, excluded_category_ids, note
      FROM plugin_budgets.account_lines
      WHERE period_start = ${start}::date
        AND period_end = ${end}::date
      ORDER BY account_id
    `
  }

  /** @inheritdoc */
  async upsert(line: NewAccountLine): Promise<AccountLineRow | undefined> {
    const rows = await this.q<AccountLineRow>`
      INSERT INTO plugin_budgets.account_lines
        (user_id, account_id, period_start, period_end, planned, rollover, excluded_category_ids, note)
      VALUES (
        core.current_user_id(), ${line.accountId}, ${line.periodStart}::date, ${line.periodEnd}::date,
        ${line.planned}::numeric, ${line.rollover}, ${[...line.excludedCategoryIds]}::uuid[], ${line.note}
      )
      ON CONFLICT (user_id, account_id, period_start) DO UPDATE
        SET planned = EXCLUDED.planned,
            rollover = EXCLUDED.rollover,
            excluded_category_ids = EXCLUDED.excluded_category_ids,
            note = EXCLUDED.note,
            updated_at = now()
      RETURNING id, account_id, period_start::text, planned::text, rollover, excluded_category_ids, note
    `
    return rows[0]
  }

  /** @inheritdoc */
  async copyMonth(sourceMonth: string, targetMonth: string): Promise<number> {
    const source = monthPeriod(sourceMonth)
    const target = monthPeriod(targetMonth)
    // One statement, as for category lines: the month is one decision, and a
    // partial copy left behind by a mid-loop failure would be a month whose
    // allowance is quietly missing. The exclusions travel with the line.
    const created = await this.q<{ id: string }>`
      INSERT INTO plugin_budgets.account_lines
        (user_id, account_id, period_start, period_end, planned, rollover, excluded_category_ids, note)
      SELECT a.user_id, a.account_id, ${target.start}::date, ${target.end}::date,
             a.planned, a.rollover, a.excluded_category_ids, a.note
      FROM plugin_budgets.account_lines a
      WHERE a.period_start = ${source.start}::date
        AND a.period_end = ${source.end}::date
      ON CONFLICT (user_id, account_id, period_start) DO NOTHING
      RETURNING id
    `
    return created.length
  }

  /** @inheritdoc */
  async deleteForMonth(accountId: string, monthKey: string): Promise<number> {
    const { start, end } = monthPeriod(monthKey)
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_budgets.account_lines
      WHERE account_id = ${accountId}
        AND period_start = ${start}::date
        AND period_end = ${end}::date
      RETURNING id
    `
    return gone.length
  }

  /** @inheritdoc */
  listAll(): Promise<ExportedAccountLine[]> {
    return this.q<ExportedAccountLine>`
      SELECT id, account_id, period_start, period_end, planned, rollover, excluded_category_ids, note,
             created_at, updated_at
      FROM plugin_budgets.account_lines
      ORDER BY period_start, account_id
    `
  }
}
