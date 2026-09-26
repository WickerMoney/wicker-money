import type { FastifyInstance } from 'fastify'
import type { Services } from '../../composition/Services.js'
import { registerCategorizeTransactions } from './handlers/categorizeTransactions.js'
import { registerCreateTransaction } from './handlers/createTransaction.js'
import { registerCreateTransfer } from './handlers/createTransfer.js'
import { registerDeleteTransaction } from './handlers/deleteTransaction.js'
import { registerListTransactionSplits } from './handlers/listTransactionSplits.js'
import { registerListTransactions } from './handlers/listTransactions.js'
import { registerRemoveTransactionSplits } from './handlers/removeTransactionSplits.js'
import { registerReplaceTransactionSplits } from './handlers/replaceTransactionSplits.js'
import { registerUpdateTransaction } from './handlers/updateTransaction.js'

/**
 * Registers every transaction endpoint under `/api/v1/transactions`.
 *
 * Static paths (`/categorize`, `/transfer`) are registered before the
 * parameterised `/:id` routes for readability; Fastify's router prefers static
 * segments regardless of order.
 *
 * @param app - The Fastify instance to register routes on.
 * @param services - The application services.
 */
export function registerTransactionRoutes(app: FastifyInstance, { transactions }: Services): void {
  registerListTransactions(app, transactions)
  registerCategorizeTransactions(app, transactions)
  registerCreateTransaction(app, transactions)
  registerUpdateTransaction(app, transactions)
  registerCreateTransfer(app, transactions)
  registerDeleteTransaction(app, transactions)
  registerReplaceTransactionSplits(app, transactions)
  registerListTransactionSplits(app, transactions)
  registerRemoveTransactionSplits(app, transactions)
}
