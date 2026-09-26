import { z } from 'zod'
import { isoDate } from './isoDate.js'
import { transactionCursor } from './transactionCursor.js'

/** Query string for listing transactions: optional filters, a sort, and a cursor page window. */
export const listTransactionsQuery = z.object({
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  /**
   * When `'true'`, only transactions with no category.
   *
   * This is the triage filter. A fresh import leaves everything uncategorized
   * unless a rule happened to match, so this is the list a person actually
   * works through; without it the only way to find those rows is to read every
   * page looking for a blank category.
   */
  uncategorized: z.enum(['true', 'false']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['date', 'amount', 'merchant']).default('date'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The `nextCursor` of the previous page. Omit for the first page. */
  cursor: transactionCursor.optional(),
  /**
   * When `'true'`, the response also carries `total`, the number of rows
   * matching the filters. It costs a count over every match, so it is off unless
   * asked for.
   */
  withTotal: z.enum(['true', 'false']).default('false'),
})

/** A parsed `listTransactionsQuery`, with defaults applied. */
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuery>
