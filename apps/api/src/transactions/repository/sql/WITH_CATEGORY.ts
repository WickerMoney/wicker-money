import { sql } from 'kysely'

/**
 * SQL `FROM` clause aliasing `core.transactions` as `t` and left-joining
 * `core.categories` as `c`, so `KIND_EXPRESSION` and
 * `MAGNITUDE_EXPRESSION` resolve. Uncategorized rows keep a null `c`.
 */
export const WITH_CATEGORY = sql`
  FROM core.transactions t
  LEFT JOIN core.categories c ON c.id = t.category_id
`
