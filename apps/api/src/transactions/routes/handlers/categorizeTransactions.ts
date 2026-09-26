import type { FastifyInstance } from 'fastify'
import { parseBody } from '../../../http/parseBody.js'
import type { TransactionService } from '../../service/TransactionService.js'
import { categorizeTransactionsBody } from '../schemas/categorizeTransactionsBody.js'

/**
 * Registers `POST /api/v1/transactions/categorize`: assigns one category to
 * many transactions at once.
 *
 * Every assignment is recorded with source `manual`, because a person picked
 * it. A `categoryId` of `null` clears the category, which is the way back from a
 * mistake. Transfer legs are skipped (a transfer has no category).
 *
 * Responds `200` with `{ updated, requested, skippedTransfers }`. Responds
 * `400` if the body is invalid, the category is not the caller's, or only
 * transfer legs were selected.
 */
export function registerCategorizeTransactions(app: FastifyInstance, service: TransactionService): void {
  app.post('/api/v1/transactions/categorize', async (request) => {
    const user = await app.requireAuth(request)
    const body = parseBody(categorizeTransactionsBody, request.body)
    return service.categorize(user.id, body.transactionIds, body.categoryId)
  })
}
