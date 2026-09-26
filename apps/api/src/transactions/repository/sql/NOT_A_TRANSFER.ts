import { sql } from 'kysely'

/**
 * SQL predicate that excludes both legs of every transfer (rows with a transfer
 * id or counterparty account, or in a `transfer`-kind category). Uses the `t` /
 * `c` aliases from `WITH_CATEGORY`.
 *
 * A predicate rather than a filter on the classified kind, because it can use
 * the indexes and because a query that only wants spending should never carry
 * transfer rows through an aggregate to throw them away at the end.
 */
export const NOT_A_TRANSFER = sql`
  t.transfer_id IS NULL
  AND t.transfer_account_id IS NULL
  AND (c.kind IS NULL OR c.kind <> 'transfer')
`
