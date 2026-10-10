import { Suspense, type ReactNode } from 'react'
import { Spinner } from '@wickermoney/ui-kit'
import { ErrorBoundary } from './ErrorBoundary.js'

/** Props for {@link PageBoundary}. */
export interface PageBoundaryProps {
  /** Names the page in the loading label and in the error fallback. */
  readonly label: string
  /** The (possibly lazily loaded) page. */
  readonly children: ReactNode
}

/**
 * Wraps a route-split page: a labelled spinner while its chunk downloads and an
 * error boundary, so a failed chunk fetch (offline, or a stale deploy) shows a
 * message instead of a blank shell. The shell around it, including the tab
 * title and focus handling, does not wait for the chunk. The error boundary is
 * keyed by `label` so one page's failure is not carried onto the next route.
 */
export function PageBoundary({ label, children }: PageBoundaryProps) {
  return (
    <ErrorBoundary key={label} label={label}>
      <Suspense fallback={<Spinner label={`Loading ${label}`} />}>{children}</Suspense>
    </ErrorBoundary>
  )
}
