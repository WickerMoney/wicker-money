import { monthLabel } from './monthLabel.js'
import { monthLabelLong } from './monthLabelLong.js'

/**
 * The label under a month's bar.
 *
 * The year is added to the first label and to every January, so a twelve-month
 * axis that crosses a year boundary says where it crosses; every other label
 * stays short enough to sit under its own bar.
 *
 * @param month - A month as `YYYY-MM`.
 * @param first - Whether this is the first month on the axis.
 * @returns For example `"Oct 2025"` or `"Nov"`.
 */
export function axisLabel(month: string, first: boolean): string {
  return first || month.endsWith('-01') ? monthLabelLong(month) : monthLabel(month)
}
