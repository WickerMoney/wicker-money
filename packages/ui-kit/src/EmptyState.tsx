import type { ReactNode } from 'react'

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** Short heading saying what is empty. */
  readonly title: string
  /** A sentence of guidance shown under the title. */
  readonly hint?: string
  /** A call to action, such as a button, shown under the hint. */
  readonly action?: ReactNode
}

/** A placeholder for a list or panel that has nothing to show yet. */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="wm-empty">
      <div className="wm-empty__title">{title}</div>
      {hint !== undefined ? <div>{hint}</div> : null}
      {action !== undefined ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}
