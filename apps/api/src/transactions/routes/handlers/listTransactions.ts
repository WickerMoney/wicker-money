import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { encodeTransactionCursor } from '../schemas/encodeTransactionCursor.js'
import { listTransactionsQuery } from '../schemas/listTransactionsQuery.js'

/**
 * Registers `GET /api/v1/transactions`: a filtered, sorted, cursor-paged
 * listing of the caller's transactions.
 *
 * Responds `200` with `{ items, nextCursor }`. Pass `nextCursor` back as
 * `cursor` (with the same sort and direction) to get the following page; it is
 * `null` on the last page. `limit` is at most 200. With `withTotal=true` the
 * response also has `total`, counting every row matching the filters. Responds
 * `400` if the query string is invalid, including a malformed cursor or one
 * issued for a different sort.
 */
export function registerListTransactions(app: FastifyInstance, service: TransactionService): void {
  app.get('/api/v1/transactions', async (request) => {
    const user = await app.requireAuth(request)
    const { uncategorized, withTotal, ...query } = parseBody(listTransactionsQuery, request.query)
    const result = await service.list(user.id, {
      ...query,
      uncategorizedOnly: uncategorized === 'true',
      withTotal: withTotal === 'true',
    })
    return {
      items: result.items,
      nextCursor: result.nextCursor === null ? null : encodeTransactionCursor(result.nextCursor),
      ...(result.total === undefined ? {} : { total: result.total }),
    }
  })
}
