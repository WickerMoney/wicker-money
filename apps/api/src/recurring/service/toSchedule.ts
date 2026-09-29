import type { RecurrenceSchedule } from '@wickermoney/plugin-sdk/recurrence'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'

/**
 * The SDK's view of a stored item's schedule.
 *
 * @param row - A stored item.
 * @returns Its schedule, with the two semimonthly columns as the SDK's pair.
 */
export function toSchedule(row: RecurringItemRow): RecurrenceSchedule {
  return {
    frequency: row.frequency,
    seriesStartDate: row.series_start_date,
    endDate: row.end_date,
    semimonthlyDays:
      row.semimonthly_day_1 === null || row.semimonthly_day_2 === null
        ? null
        : [row.semimonthly_day_1, row.semimonthly_day_2],
  }
}
