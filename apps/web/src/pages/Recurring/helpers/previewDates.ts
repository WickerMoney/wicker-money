import { occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { RecurringDraft } from '../state/RecurringDraft.js'

/** How far ahead the preview looks: long enough for a yearly item's next date. */
const LOOKAHEAD_DAYS = 800

/**
 * The next few dates the draft would occur on, from today, for the form's
 * preview.
 *
 * The only place the browser does recurrence maths: the item is not saved
 * yet, so there is nothing to ask the server about. `today` still comes from
 * the server, so the preview and the saved item agree.
 *
 * @param draft - The form state.
 * @param today - The server's today, `YYYY-MM-DD`.
 * @param count - How many dates to show.
 * @returns Up to `count` dates, or `null` while the schedule is incomplete or invalid.
 */
export function previewDates(draft: RecurringDraft, today: string, count = 5): string[] | null {
  if (draft.seriesStartDate === '') return null
  try {
    const dates = occurrences(
      {
        frequency: draft.frequency,
        seriesStartDate: draft.seriesStartDate,
        endDate: draft.endDate === '' ? null : draft.endDate,
        semimonthlyDays: draft.frequency === 'semimonthly' ? [Number(draft.day1), Number(draft.day2)] : null,
      },
      today,
      addDays(today, LOOKAHEAD_DAYS),
    )
    return dates.slice(0, count)
  } catch {
    return null
  }
}

/** Adds days to a `YYYY-MM-DD` date on a UTC calendar, so no DST change can move it. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
