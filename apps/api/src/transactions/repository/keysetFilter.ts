import { sql, type Expression, type SqlBool } from 'kysely'
import { SORT_CASTS } from './SORT_CASTS.js'
import { SORT_COLUMNS } from './SORT_COLUMNS.js'
import type { TransactionListCriteria } from './TransactionListCriteria.js'
import type { TransactionPosition } from './TransactionPosition.js'

/**
 * Builds the predicate that keeps only the rows after a position in the sort
 * order.
 *
 * The primary sort column and the id are ordered in the same direction, so
 * "after" is a single row comparison, `(column, id) > (value, id)` ascending or
 * `<` descending, which is exactly lexicographic order. Mixing directions
 * (primary descending, id ascending) would make that comparison wrong.
 *
 * PostgreSQL turns the leading column of a row comparison into an index bound
 * by itself, so an index on the sort column starts at the position rather than
 * reading everything before it.
 *
 * @param sort - The column being sorted on.
 * @param direction - The sort direction.
 * @param after - The position of the last row already seen.
 * @returns A predicate over `core.transactions`.
 */
export function keysetFilter(
  sort: TransactionListCriteria['sort'],
  direction: TransactionListCriteria['direction'],
  after: TransactionPosition,
): Expression<SqlBool> {
  const column = sql.ref(SORT_COLUMNS[sort])
  const cast = sql.raw(SORT_CASTS[sort])
  const value = sql`${after.value}::${cast}`
  const past = sql.raw(direction === 'desc' ? '<' : '>')
  return sql<SqlBool>`(${column}, id) ${past} (${value}, ${after.id}::uuid)`
}
