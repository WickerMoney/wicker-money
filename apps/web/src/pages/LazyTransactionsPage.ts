import { lazy } from 'react'

/** The Transactions page, split into its own chunk and fetched on first visit. */
export const LazyTransactionsPage = lazy(() => import('./Transactions/index.js').then((m) => ({ default: m.TransactionsPage })))
