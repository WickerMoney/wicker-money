import { useEffect, useRef } from 'react'
import { Alert } from '@wickermoney/ui-kit'

/** Props for {@link SectionNotice}. */
export interface SectionNoticeProps {
  /** The message, or `null` to show nothing. */
  readonly message: string | null
}

/**
 * A message that belongs to one section of the page (carrying lines over, a
 * line that could not be removed), shown at the top of that section.
 *
 * A message at the top of the page is out of sight when the person acted
 * lower down, and a tall page frame is a long way down: the window scrolls, not
 * the frame. So the message is also scrolled into view, the least that shows
 * it (`nearest`: nothing moves when it is already visible). There is no host
 * notification to use instead (ADR 0010, decision D4), and this is the same
 * `scrollIntoView` that carries a form's first invalid field out of a frame.
 */
export function SectionNotice({ message }: SectionNoticeProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (message !== null) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [message])

  if (message === null) return null
  return <div className="bud__notice" ref={ref}><Alert>{message}</Alert></div>
}
