import type { ReactNode } from 'react'

/** Props for {@link Alert}. */
export interface AlertProps {
  /** The message to show. */
  readonly children: ReactNode
}

/** A message banner with `role="alert"`, used for errors and notices. */
export function Alert({ children }: AlertProps) {
  return <div className="fio-alert" role="alert">{children}</div>
}
