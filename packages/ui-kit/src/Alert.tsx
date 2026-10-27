import type { ReactNode } from 'react'

/** Props for {@link Alert}. */
export interface AlertProps {
  /** The message to show. */
  readonly children: ReactNode
}

/**
 * A message banner with `role="alert"`, for a state that stays true until it is
 * fixed: a page or section that failed to load, a plugin that failed to start.
 * It is not for the result of an action (a save, a delete): raise a toast with
 * `useToast` for that, and put a refusal that belongs to a field or form on
 * the field or in `FormError` (ADR 0009).
 */
export function Alert({ children }: AlertProps) {
  return <div className="wm-alert" role="alert">{children}</div>
}
