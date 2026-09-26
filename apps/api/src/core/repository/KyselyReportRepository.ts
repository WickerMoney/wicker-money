import { sql } from 'kysely'
import type { Trx } from '../../db/Trx.js'
import { NOT_A_TRANSFER } from '../../transactions/repository/sql/NOT_A_TRANSFER.js'
import type { AccountPick } from './AccountPick.js'
import type { CategoryPick } from './CategoryPick.js'
import type { MonthlyTotalRow } from './MonthlyTotalRow.js'
import type { ReportRepository } from './ReportRepository.js'

/** Kysely implementation of {@link ReportRepository} over a single transaction. */
export class KyselyReportRepository implements ReportRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  async findTimezone(userId: string): Promise<string | undefined> {
    const row = await this.trx
      .selectFrom('core.users')
      .select('timezone')
      .where('id', '=', userId)
      .executeTakeFirst()
    return row?.timezone
  }

  /** @inheritdoc */
  async countActiveAccounts(): Promise<number> {
    const row = await this.trx
      .selectFrom('core.accounts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('archived_at', 'is', null)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  }

  /** @inheritdoc */
  async listActiveAccounts(): Promise<AccountPick[]> {
    const result = await sql<AccountPick>`
      SELECT id, name, account_type::text AS type
      FROM core.accounts
      WHERE archived_at IS NULL
      ORDER BY name
    `.execute(this.trx)
    return result.rows
  }

  /** @inheritdoc */
  listEnabledCategories(): Promise<CategoryPick[]> {
    return this.trx
      .selectFrom('core.categories')
      .select(['id', 'name', 'parent_id'])
      .where('is_enabled', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute()
  }

  /**
   * @inheritdoc
   *
   * A parent contributes `amount - COALESCE(sum of its splits, 0)`: an unsplit
   * transaction its whole amount, a fully split one nothing, a partly split one
   * the remainder. Each split is then classified by its own category, because a
   * split can move money into a different kind of category than its parent.
   * Transfer legs and transfer-kind categories are excluded, and a part with
   * no category falls back to its sign.
   */
  async monthlyTotals(since: string): Promise<MonthlyTotalRow[]> {
    const result = await sql<MonthlyTotalRow>`
      WITH base AS (
        SELECT t.id, t.category_id, t.amount, t.transaction_date
        FROM core.transactions t
        LEFT JOIN core.categories c ON c.id = t.category_id
        WHERE ${NOT_A_TRANSFER}
          AND t.transaction_date >= ${since}::date
      ),
      split_totals AS (
        SELECT s.transaction_id, SUM(s.amount) AS split_sum
        FROM core.transaction_splits s
        JOIN base b ON b.id = s.transaction_id
        GROUP BY s.transaction_id
      ),
      parts AS (
        SELECT b.category_id, b.transaction_date, b.amount - COALESCE(st.split_sum, 0) AS amount
        FROM base b
        LEFT JOIN split_totals st ON st.transaction_id = b.id
        UNION ALL
        SELECT s.category_id, b.transaction_date, s.amount
        FROM core.transaction_splits s
        JOIN base b ON b.id = s.transaction_id
      ),
      classified AS (
        SELECT p.category_id, c.name AS category_name, p.transaction_date, p.amount,
          CASE
            WHEN c.kind IS NOT NULL THEN c.kind::text
            WHEN p.amount > 0 THEN 'income'
            ELSE 'expense'
          END AS kind
        FROM parts p
        LEFT JOIN core.categories c ON c.id = p.category_id
        WHERE p.amount <> 0
      )
      SELECT
        to_char(transaction_date, 'YYYY-MM') AS month,
        category_id,
        category_name,
        kind,
        SUM(CASE WHEN amount > 0 AND kind = 'income' THEN amount ELSE -amount END)::text AS total
      FROM classified
      WHERE kind <> 'transfer'
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 4, 3
    `.execute(this.trx)
    return result.rows
  }
}
