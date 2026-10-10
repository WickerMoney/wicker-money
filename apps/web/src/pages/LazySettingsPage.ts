import { lazy } from 'react'

/** The Settings page, split into its own chunk and fetched on first visit. */
export const LazySettingsPage = lazy(() => import('./Settings/index.js').then((m) => ({ default: m.SettingsPage })))
