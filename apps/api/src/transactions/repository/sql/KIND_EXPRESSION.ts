import { sql } from 'kysely'

/**
 * SQL expression classifying a transaction as `'income'`, `'expense'` or
 * `'transfer'`: money in, money out, or money moving.
 *
 * One shared definition, so every query that aggregates spending agrees. If
 * each query wrote its own `WHERE amount < 0`, they would disagree (for example
 * one summing signed amounts and another filtering to negatives, so a refund
 * would reduce a budget yet be invisible on a chart).
 *
 * Expects the aliases `t` (`core.transactions`) and `c` (`core.categories`,
 * left-joined); `WITH_CATEGORY` provides them.
 *
 * The rule, in order:
 *
 *  1. **A transfer leg is a transfer.** Money you moved between your own
 *     accounts is neither earned nor spent, and counting it as either is the
 *     single biggest way a spending chart overstates. Both legs are excluded,
 *     so the pair nets to nothing whichever way you look at it.
 *  2. **A category of kind `transfer` is a transfer**, even on a row with no
 *     counterparty. A credit-card payment typed in by hand is still money
 *     moving, and this is the escape hatch for one that was never recorded as a
 *     proper pair.
 *  3. **Otherwise the category's kind decides.** This is what stops a £25
 *     supermarket refund — a positive amount against an expense category —
 *     from being counted as income. It stays an expense, a negative one,
 *     which reduces what that category cost this month.
 *  4. **With no category, the sign decides.** A fresh import is entirely
 *     uncategorized, and a chart that showed nothing until it had been triaged
 *     would be useless exactly when it is most wanted.
 */
export const KIND_EXPRESSION = sql`
  CASE
    WHEN t.transfer_id IS NOT NULL OR t.transfer_account_id IS NOT NULL THEN 'transfer'
    WHEN c.kind = 'transfer' THEN 'transfer'
    WHEN c.kind IS NOT NULL THEN c.kind::text
    WHEN t.amount > 0 THEN 'income'
    ELSE 'expense'
  END
`
