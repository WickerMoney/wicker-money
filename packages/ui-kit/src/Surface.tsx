import type { ReactNode } from 'react'

/** Props for {@link Surface}. */
export interface SurfaceProps {
  /** Heading shown at the top of the surface. */
  readonly title?: string
  /** Rendered opposite the title: actions, a filter, a total. */
  readonly action?: ReactNode
  /** The surface content. */
  readonly children?: ReactNode
  /**
   * Heading level for the title. Defaults to `2`, since a surface normally sits
   * under its page's own heading; pass `1` when the surface is the page.
   */
  readonly level?: 1 | 2
}

/** A titled panel. The container that widgets and pages sit inside. */
export function Surface({ title, action, children, level = 2 }: SurfaceProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  const hasHeader = title !== undefined || action !== undefined
  return (
    <section className="wm-surface">
      {hasHeader ? (
        <div className="wm-surface__header">
          {title === undefined ? <span /> : <Heading className="wm-surface__title">{title}</Heading>}
          {action}
        </div>
      ) : null}
      <div className="wm-surface__body">{children}</div>
    </section>
  )
}
