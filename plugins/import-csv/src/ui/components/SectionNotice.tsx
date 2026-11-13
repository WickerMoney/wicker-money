import { useEffect, useRef } from 'react'
import { Alert } from '@wickermoney/ui-kit'

/** Props for {@link SectionNotice}. */
export interface SectionNoticeProps {
  /** The message, or `null` to show nothing. */
  readonly message: string | null
  /** `alert` (the default) for something that is wrong; `status` for a plain result, which is read out politely. */
  readonly kind?: 'alert' | 'status'
}

/**
 * A message that belongs to one section of the page (the file that could not
 * be sent, an import that could not be undone), shown at the top of that
 * section and scrolled into view.
 *
 * A message at the top of the page is out of sight when the person acted lower
 * down, and a tall page frame is a long way down: the window scrolls, not the
 * frame. `nearest` moves the window by the least that shows the message, and
 * not at all when it is already visible. There is no host notification to use
 * instead (ADR 0010, decision D4); this is the same pattern as the Budgets page.
 */
export function SectionNotice({ message, kind = 'alert' }: SectionNoticeProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (message !== null) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [message])

  if (message === null) return null
  return (
    <div className="imp__notice" ref={ref}>
      {kind === 'alert' ? <Alert>{message}</Alert> : <p className="imp__hint" role="status">{message}</p>}
    </div>
  )
}
