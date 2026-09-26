import { sql } from 'kysely'
import { KIND_EXPRESSION } from './KIND_EXPRESSION.js'

/**
 * SQL expression for a row's amount in the direction its kind implies.
 *
 * A positive income amount is kept as recorded; anything else is negated so
 * spending reads as a positive amount of money spent. The negation is what lets
 * a refund reduce a total rather than inflate it: `-(+25)` is `-25` against an
 * expense category, and the month's figure drops by 25.
 *
 * Uses {@link KIND_EXPRESSION}, so it needs the same `t` / `c` aliases.
 *
 * Deliberately NOT `abs()`. Taking the absolute value would make a refund add
 * £25 to what Groceries cost, which is the opposite of what happened and the
 * kind of error that survives review because every number still looks
 * plausible.
 */
export const MAGNITUDE_EXPRESSION = sql`
  CASE WHEN t.amount > 0 AND ${KIND_EXPRESSION} = 'income' THEN t.amount ELSE -t.amount END
`
