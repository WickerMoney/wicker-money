import { lazy } from 'react'

/** The Categories page, split into its own chunk and fetched on first visit. */
export const LazyCategoriesPage = lazy(() => import('./Categories/index.js').then((m) => ({ default: m.CategoriesPage })))
