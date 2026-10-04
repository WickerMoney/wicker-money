import type { ExpressionBuilder } from 'kysely'
import type { Database } from '../../db/models/index.js'
import { escapeLikePattern } from './escapeLikePattern.js'
import type { TransactionFilterCriteria } from './TransactionFilterCriteria.js'

/**
 * Builds the `where` predicate for a transaction listing.
 *
 * Returned as a predicate factory rather than a function that narrows a query
 * builder, so the same filters can be applied to both a page query and a count
 * query. A generic "narrow the builder" helper does not typecheck, because the
 * two builder types have structurally incompatible `where` overloads.
 *
 * @param criteria - The filters. Absent filters contribute no clause.
 * @returns A function that, given an expression builder over
 * `core.transactions`, returns the conjunction of every active filter.
 */
export function transactionFilters(criteria: TransactionFilterCriteria) {
  return (eb: ExpressionBuilder<Database, 'core.transactions'>) => {
    const clauses = []
    if (criteria.accountId !== undefined) clauses.push(eb('account_id', '=', criteria.accountId))
    if (criteria.uncategorizedOnly === true) {
      // A transfer leg can never take a category (TRANSFER_HAS_NO_CATEGORY),
      // so without this every transfer would sit in the triage list forever.
      // Spelling out `transfer_id IS NULL` also lets the planner use the
      // partial index `ix_transactions_uncategorized`, whose predicate is
      // exactly these two clauses.
      clauses.push(eb('category_id', 'is', null), eb('transfer_id', 'is', null))
    }
    if (criteria.categoryId !== undefined) {
      // A parent matches everything under it. Picking "Food" and seeing only
      // what was filed directly against Food, rather than Groceries, Takeout
      // and Coffee shops, is the surprising reading.
      //
      // One subquery rather than a recursive CTE, because the tree is exactly
      // two levels deep and is enforced that way on create and move. If that
      // ever changes this is the first thing that breaks, which is preferable
      // to a recursive query that silently keeps working on a shape nothing
      // else supports.
      clauses.push(
        eb.or([
          eb('category_id', '=', criteria.categoryId),
          eb(
            'category_id',
            'in',
            eb.selectFrom('core.categories').select('id').where('parent_id', '=', criteria.categoryId),
          ),
        ]),
      )
    }
    if (criteria.from !== undefined) clauses.push(eb('transaction_date', '>=', criteria.from))
    if (criteria.to !== undefined) clauses.push(eb('transaction_date', '<=', criteria.to))
    if (criteria.search !== undefined) {
      clauses.push(eb('merchant', 'ilike', `%${escapeLikePattern(criteria.search)}%`))
    }
    return eb.and(clauses)
  }
}
