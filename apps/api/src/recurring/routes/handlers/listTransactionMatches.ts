import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { RecurringOccurrenceService } from '../../service/RecurringOccurrenceService.js'
import { transactionMatchesQuery } from '../schemas/transactionMatchesQuery.js'

/**
 * Registers `GET /api/v1/recurring-items/transaction-matches?transactionIds=a,b,...`:
 * for a page of the transaction list, in one request, the occurrence each
 * transaction settles, the occurrence suggested for it (the same suggestions
 * as `GET .../suggestions`), and the occurrences it was dismissed for.
 *
 * Responds `200` with `{ today, transactions }`, listing only transactions
 * with something to show; `400` for more than 200 ids or one that is not a UUID.
 */
export function registerListTransactionMatches(app: FastifyInstance, service: RecurringOccurrenceService): void {
  app.get('/api/v1/recurring-items/transaction-matches', async (request) => {
    const user = await app.requireAuth(request)
    const { transactionIds } = parseBody(transactionMatchesQuery, request.query ?? {})
    return service.forTransactions(user.id, transactionIds)
  })
}
