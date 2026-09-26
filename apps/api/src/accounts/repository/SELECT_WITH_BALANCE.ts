import { sql } from 'kysely'

/**
 * SQL fragment selecting accounts with the balance DERIVED rather than read
 * from a column.
 *
 * A stored balance that is recomputed on write can persist a wrong number
 * indefinitely if a recalculation is ever missed. A lateral sum cannot drift:
 * it is recomputed from the ledger on every read, and at personal-finance row
 * counts the indexed aggregate is trivial. The sum is cast to text inside the
 * database so arbitrarily large values reach the caller as an exact decimal
 * string. The row-level-security policy adds a `user_id` filter to the
 * transactions subquery, so an index-only scan needs `user_id` in the index
 * alongside `amount`. Append a `WHERE` and/or `ORDER BY` clause; the alias for the
 * accounts table is `a`.
 */
export const SELECT_WITH_BALANCE = sql`
  SELECT
    a.id, a.name, a.account_type, a.initial_balance, a.currency_code,
    a.buffer_amount, a.archived_at, a.created_at, a.updated_at,
    (a.initial_balance + COALESCE(t.total, 0))::text AS balance
  FROM core.accounts a
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS total FROM core.transactions
    WHERE account_id = a.id
  ) t ON true
`
