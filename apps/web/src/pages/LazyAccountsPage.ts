import { lazy } from 'react'

/** The Accounts page, split into its own chunk and fetched on first visit. */
export const LazyAccountsPage = lazy(() => import('./Accounts/index.js').then((m) => ({ default: m.AccountsPage })))
