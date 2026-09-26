import type { ReactNode } from 'react'

/** Props for {@link Surface}. */
export interface SurfaceProps {
  /** Heading shown at the top of the surface. */
  readonly title?: string
  /** Rendered opposite the title: actions, a filter, a total. */
  readonly action?: ReactNode
  /** The surface content. */
  readonly children?: ReactNode
}

/** A titled panel. The container that widgets and pages sit inside. */
export function Surface({ title, action, children }: SurfaceProps) {
  const hasHeader = title !== undefined || action !== undefined
  return (
    <section className="fio-surface">
      {hasHeader ? (
        <div className="fio-surface__header">
          {title === undefined ? <span /> : <h2 className="fio-surface__title">{title}</h2>}
          {action}
        </div>
      ) : null}
      <div className="fio-surface__body">{children}</div>
    </section>
  )
}
