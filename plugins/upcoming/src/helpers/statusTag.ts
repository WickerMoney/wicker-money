import type { UpcomingOccurrence } from '../models/index.js'

/** A short tag for an occurrence that is not simply "on its way, on schedule". */
export interface StatusTag {
  readonly label: string
  /** `warn` for something the user may need to chase. */
  readonly tone: 'muted' | 'warn'
}

/**
 * Describes where an occurrence stands, for the tag beside its name.
 *
 * @param o - The occurrence.
 * @param formatDate - Formats a `YYYY-MM-DD` date for display.
 * @returns The tag, or `null` when there is nothing to say.
 */
export function statusTag(o: UpcomingOccurrence, formatDate: (value: string) => string): StatusTag | null {
  switch (o.status) {
    case 'cleared': return { label: 'Arrived', tone: 'muted' }
    case 'late': return { label: `Late, due ${formatDate(o.expectedDate ?? o.date)}`, tone: 'warn' }
    case 'due': return { label: 'Not in yet', tone: 'warn' }
    default: return o.moved === true ? { label: 'Moved', tone: 'muted' } : null
  }
}
