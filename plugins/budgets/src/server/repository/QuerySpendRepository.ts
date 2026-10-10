import { monthPeriod } from '../../shared/index.js'
import type { AccountScope } from './AccountScope.js'
import type { CategoryRange } from './CategoryRange.js'
import type { Query } from '@wickermoney/plugin-sdk/server'
import type { SpendRepository } from './SpendRepository.js'

/**
 * {@link SpendRepository} over a user-bound query runner.
 *
 * A parent transaction contributes `amount - COALESCE(sum of its splits, 0)`.
 * That single expression covers all three cases: an unsplit transaction
 * contributes its whole amount, a fully split one contributes nothing, and a
 * partially split one contributes exactly the remainder. This is what makes
 * period totals reconcile against the ledger, since each split adds to its own
 * category instead of the whole amount landing on the parent.
 *
 * Three exclusions, each a different way a budget could overstate:
 *
 *  - **Transfer legs.** Moving your own money between accounts is not spending
 *    it. Both legs are excluded, so the pair nets to nothing however it is sliced.
 *  - **Categories of kind `transfer`.** A credit-card payment typed by hand is
 *    still money moving even when it was never recorded as a proper pair.
 *  - **Categories of kind `income`.** A budget measures outflow; a salary line
 *    netting negative against a plan is arithmetically true and meaningless.
 *
 * A refund is deliberately not excluded. The query sums signed amounts and
 * negates the total rather than filtering to `amount < 0`, so a return posted
 * against Groceries reduces what Groceries cost this month.
 */
export class QuerySpendRepository implements SpendRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  async byCategory(monthKey: string): Promise<Map<string, string>> {
    const { start, end } = monthPeriod(monthKey)
    const all = await this.byCategoryAndMonth(start, end)
    // Every key in the range belongs to this month; the month part is dropped.
    const out = new Map<string, string>()
    for (const [key, spent] of all) out.set(key.slice(0, key.lastIndexOf(':')), spent)
    return out
  }

  /** @inheritdoc */
  async byCategoryAndMonth(
    start: string,
    end: string,
    categoryIds?: readonly string[],
  ): Promise<Map<string, string>> {
    const only = categoryIds === undefined ? null : [...categoryIds]
    const rows = await this.q<{ category_id: string; month_key: string; spent: string }>`
      WITH expenses AS (
        SELECT t.id, t.category_id, t.amount, t.transaction_date
        FROM core.transactions t
        LEFT JOIN core.categories c ON c.id = t.category_id
        WHERE t.transaction_date >= ${start}::date
          AND t.transaction_date <  ${end}::date
          AND t.transfer_id IS NULL
          AND t.transfer_account_id IS NULL
          AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income'))
      ),
      split_totals AS (
        SELECT s.transaction_id, SUM(s.amount) AS split_sum
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
        GROUP BY s.transaction_id
      ),
      parts AS (
        SELECT e.category_id, e.transaction_date, e.amount - COALESCE(st.split_sum, 0) AS amount
        FROM expenses e
        LEFT JOIN split_totals st ON st.transaction_id = e.id
        UNION ALL
        SELECT s.category_id, e.transaction_date, s.amount
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
      )
      SELECT category_id,
             to_char(transaction_date, 'YYYY-MM') AS month_key,
             (-SUM(amount))::text AS spent
      FROM parts
      WHERE category_id IS NOT NULL
        -- Filtered here, after the parts are built, because a split's category
        -- can differ from its parent's.
        AND (${only}::uuid[] IS NULL OR category_id = ANY(${only}::uuid[]))
      GROUP BY category_id, to_char(transaction_date, 'YYYY-MM')
      HAVING SUM(amount) <> 0
    `
    return new Map(rows.map((r) => [`${r.category_id}:${r.month_key}`, r.spent]))
  }

  /** @inheritdoc */
  async byCategoryRanges(ranges: readonly CategoryRange[]): Promise<Map<string, string>> {
    if (ranges.length === 0) return new Map()
    // The ranges go in as one JSON parameter and are unpacked in SQL, as for
    // byAccountScopes, so the cost is one query however many windows there are.
    const payload = JSON.stringify(
      ranges.map((r) => ({ key: r.key, category_id: r.categoryId, from_date: r.start, to_date: r.end })),
    )
    const rows = await this.q<{ key: string; spent: string }>`
      WITH ranges AS (
        SELECT r.key, r.category_id, r.from_date::date AS from_date, r.to_date::date AS to_date
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS r(key text, category_id uuid, from_date text, to_date text)
      ),
      expenses AS (
        SELECT t.id, t.category_id, t.amount, t.transaction_date
        FROM core.transactions t
        LEFT JOIN core.categories c ON c.id = t.category_id
        WHERE t.transaction_date >= (SELECT min(from_date) FROM ranges)
          AND t.transaction_date <  (SELECT max(to_date) FROM ranges)
          AND t.transfer_id IS NULL
          AND t.transfer_account_id IS NULL
          AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income'))
      ),
      split_totals AS (
        SELECT s.transaction_id, SUM(s.amount) AS split_sum
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
        GROUP BY s.transaction_id
      ),
      parts AS (
        SELECT e.category_id, e.transaction_date, e.amount - COALESCE(st.split_sum, 0) AS amount
        FROM expenses e
        LEFT JOIN split_totals st ON st.transaction_id = e.id
        UNION ALL
        SELECT s.category_id, e.transaction_date, s.amount
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
      )
      SELECT rg.key, (-SUM(p.amount))::text AS spent
      FROM ranges rg
      JOIN parts p
        ON p.category_id = rg.category_id
       AND p.transaction_date >= rg.from_date
       AND p.transaction_date <  rg.to_date
      GROUP BY rg.key
      HAVING SUM(p.amount) <> 0
    `
    return new Map(rows.map((r) => [r.key, r.spent]))
  }

  /** @inheritdoc */
  async byAccountScopes(scopes: readonly AccountScope[]): Promise<Map<string, string>> {
    if (scopes.length === 0) return new Map()
    // The scopes go in as one JSON parameter and are unpacked in SQL, so the
    // cost is one query however many months of history are being replayed.
    const payload = JSON.stringify(
      scopes.map((s) => ({ key: s.key, account_id: s.accountId, from_date: s.start, to_date: s.end, excluded: s.excluded })),
    )
    const rows = await this.q<{ key: string; spent: string }>`
      WITH scopes AS (
        SELECT s.key, s.account_id, s.from_date::date AS from_date, s.to_date::date AS to_date, s.excluded
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS s(key text, account_id uuid, from_date text, to_date text, excluded jsonb)
      ),
      expenses AS (
        SELECT t.id, t.account_id, t.category_id, t.amount, t.transaction_date
        FROM core.transactions t
        LEFT JOIN core.categories c ON c.id = t.category_id
        WHERE t.transaction_date >= (SELECT min(from_date) FROM scopes)
          AND t.transaction_date <  (SELECT max(to_date) FROM scopes)
          AND t.account_id IN (SELECT account_id FROM scopes)
          AND t.transfer_id IS NULL
          AND t.transfer_account_id IS NULL
          AND (c.kind IS NULL OR c.kind NOT IN ('transfer', 'income'))
      ),
      split_totals AS (
        SELECT s.transaction_id, SUM(s.amount) AS split_sum
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
        GROUP BY s.transaction_id
      ),
      parts AS (
        SELECT e.account_id, e.category_id, e.transaction_date, e.amount - COALESCE(st.split_sum, 0) AS amount
        FROM expenses e
        LEFT JOIN split_totals st ON st.transaction_id = e.id
        UNION ALL
        SELECT e.account_id, s.category_id, e.transaction_date, s.amount
        FROM core.transaction_splits s
        JOIN expenses e ON e.id = s.transaction_id
      )
      SELECT sc.key, (-SUM(p.amount))::text AS spent
      FROM scopes sc
      JOIN parts p
        ON p.account_id = sc.account_id
       AND p.transaction_date >= sc.from_date
       AND p.transaction_date <  sc.to_date
       AND (p.category_id IS NULL OR NOT jsonb_exists(sc.excluded, p.category_id::text))
       -- Uncategorized money in is not a refund of anything; see the interface.
       AND (p.category_id IS NOT NULL OR p.amount < 0)
      GROUP BY sc.key
      HAVING SUM(p.amount) <> 0
    `
    return new Map(rows.map((r) => [r.key, r.spent]))
  }
}
