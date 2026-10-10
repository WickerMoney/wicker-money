import { lazy } from 'react'

/** The Recurring page, split into its own chunk and fetched on first visit. */
export const LazyRecurringPage = lazy(() => import('./Recurring/index.js').then((m) => ({ default: m.RecurringPage })))
