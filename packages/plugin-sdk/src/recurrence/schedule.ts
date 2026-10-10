import {
  clampedMonthDate, fromDayNumber, monthsBetween, parseDate, toDayNumber,
} from '../date/calendar.js'
import { DEFAULT_SEMIMONTHLY_DAYS, type RecurrenceSchedule } from './types.js'

/** A schedule after validation, with its dates as day numbers. */
interface Normalized {
  readonly schedule: RecurrenceSchedule
  readonly start: number
  /** Inclusive; `Infinity` for an open-ended series. */
  readonly end: number
}

/** Frequencies that step a fixed number of days from the anchor. */
const DAY_STEPS = { daily: 1, weekly: 7, biweekly: 14 } as const
/** Frequencies that step a fixed number of months from the anchor, clamped to month end. */
const MONTH_STEPS = { monthly: 1, quarterly: 3, annual: 12 } as const

/**
 * Validates a schedule, throwing on anything a forecast could not honour.
 *
 * @param schedule - The schedule to check.
 * @returns The schedule with its anchor and end as day numbers.
 * @throws {RangeError} On an unknown frequency, an invalid date, an end before
 *   the start, or semimonthly days that are out of range or can land on the same date.
 */
function normalize(schedule: RecurrenceSchedule): Normalized {
  const { frequency } = schedule
  // Object.hasOwn, not `in`: `'toString' in DAY_STEPS` is true via the prototype.
  if (!Object.hasOwn(DAY_STEPS, frequency) && !Object.hasOwn(MONTH_STEPS, frequency)
    && frequency !== 'once' && frequency !== 'semimonthly') {
    throw new RangeError(`Unknown recurrence frequency: ${JSON.stringify(frequency)}`)
  }
  const start = toDayNumber(schedule.seriesStartDate, 'seriesStartDate')
  const end = schedule.endDate == null ? Infinity : toDayNumber(schedule.endDate, 'endDate')
  if (end < start) {
    throw new RangeError(`endDate ${schedule.endDate} is before seriesStartDate ${schedule.seriesStartDate}`)
  }
  if (frequency === 'semimonthly') semimonthlyDays(schedule)
  return { schedule, start, end }
}

/**
 * The two semimonthly days, validated and in ascending order.
 *
 * Two days that are both 28 or later collapse onto one date in February
 * (29 and 31 both clamp to the 28th), and an occurrence is identified by its
 * item and date, so the pair would silently become one payment. That is
 * refused rather than deduplicated.
 *
 * @param schedule - A semimonthly schedule.
 * @returns `[earlier, later]`.
 * @throws {RangeError} If a day is not an integer 1-31, the days are equal, or both are 28 or later.
 */
function semimonthlyDays(schedule: RecurrenceSchedule): readonly [number, number] {
  const days = schedule.semimonthlyDays ?? DEFAULT_SEMIMONTHLY_DAYS
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      throw new RangeError(`Invalid semimonthly day: ${d} (expected an integer 1-31)`)
    }
  }
  const earlier = Math.min(days[0], days[1])
  const later = Math.max(days[0], days[1])
  if (earlier === later) throw new RangeError(`Semimonthly days must differ, got ${earlier} twice`)
  if (earlier >= 28) {
    throw new RangeError(
      `Semimonthly days ${earlier} and ${later} land on the same date in February; the earlier day must be 27 or less`,
    )
  }
  return [earlier, later]
}

/**
 * Yields a schedule's occurrences as day numbers, ascending, starting at the
 * first one on or after `lower` and ending at the series end (or never).
 *
 * Every occurrence is computed from the anchor, not from the one before it,
 * so a clamp in a short month never carries forward: Jan 31 → Feb 28 → Mar 31.
 *
 * @param n - A normalized schedule.
 * @param lower - Earliest day number wanted, inclusive.
 * @returns A generator of day numbers.
 */
function* iterate(n: Normalized, lower: number): Generator<number> {
  const { schedule, start, end } = n
  const from = Math.max(lower, start)
  const { frequency } = schedule

  if (frequency === 'once') {
    if (start >= from && start <= end) yield start
    return
  }

  if (frequency === 'daily' || frequency === 'weekly' || frequency === 'biweekly') {
    const step = DAY_STEPS[frequency]
    for (let day = start + Math.ceil((from - start) / step) * step; day <= end; day += step) {
      yield day
    }
    return
  }

  const anchor = parseDate(schedule.seriesStartDate)
  const lowerDate = parseDate(fromDayNumber(from))
  // Start a month early: a clamped or earlier day in `from`'s month can still
  // be on or after `from` only in that month, and one extra month is cheap.
  const firstMonth = Math.max(0, monthsBetween(anchor.year, anchor.month, lowerDate.year, lowerDate.month) - 1)

  if (frequency === 'semimonthly') {
    const days = semimonthlyDays(schedule)
    for (let m = firstMonth; ; m += 1) {
      for (const d of days) {
        const day = toDayNumber(clampedMonthDate(anchor.year, anchor.month, m, d))
        if (day > end) return
        if (day >= from) yield day
      }
    }
  }

  if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'annual') {
    const step = MONTH_STEPS[frequency]
    for (let k = Math.floor(firstMonth / step); ; k += 1) {
      const day = toDayNumber(clampedMonthDate(anchor.year, anchor.month, k * step, anchor.day))
      if (day > end) return
      if (day >= from) yield day
    }
  }

  // Unreachable after normalize(); kept so a frequency added to the type
  // without a branch here fails loudly instead of yielding nothing.
  throw new RangeError(`Unknown recurrence frequency: ${JSON.stringify(frequency satisfies never)}`)
}

/**
 * Lists a schedule's nominal occurrence dates in a half-open range.
 *
 * Nominal means the date the schedule says, before any weekend or holiday
 * shift; `(item, nominal date)` is what identifies an occurrence.
 *
 * @param schedule - The item's schedule (a whole `RecurringItem` works).
 * @param from - First day to include, `YYYY-MM-DD`.
 * @param to - First day to exclude, `YYYY-MM-DD`. Equal to `from` gives an empty list.
 * @returns Dates as `YYYY-MM-DD`, ascending, each at most once.
 * @throws {RangeError} If the schedule is invalid (see `RecurrenceSchedule`), a
 *   date is malformed, or `to` is before `from`.
 */
export function occurrences(schedule: RecurrenceSchedule, from: string, to: string): string[] {
  const n = normalize(schedule)
  const lower = toDayNumber(from, 'from')
  const upper = toDayNumber(to, 'to')
  if (upper < lower) throw new RangeError(`Range end ${to} is before its start ${from}`)

  const out: string[] = []
  for (const day of iterate(n, lower)) {
    if (day >= upper) break
    out.push(fromDayNumber(day))
  }
  return out
}

/**
 * The first occurrence on or after a date: an item's "next due" date.
 *
 * Pass the user's today to include something due today; pass tomorrow for the
 * first occurrence the balance does not already reflect.
 *
 * @param schedule - The item's schedule.
 * @param from - Earliest date to consider, inclusive, `YYYY-MM-DD`.
 * @returns The date, or `null` if the series has ended by then.
 * @throws {RangeError} If the schedule or `from` is invalid.
 */
export function nextOccurrence(schedule: RecurrenceSchedule, from: string): string | null {
  const n = normalize(schedule)
  const first = iterate(n, toDayNumber(from, 'from')).next()
  return first.done ? null : fromDayNumber(first.value)
}
