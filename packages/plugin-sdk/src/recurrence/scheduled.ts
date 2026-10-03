import { fromDayNumber, toDayNumber } from './calendar.js'
import { nextOccurrence, occurrences } from './schedule.js'
import type { OccurrenceOverride, RecurringItem, ScheduledOccurrence } from './types.js'

/**
 * Lists an item's occurrences that land in a half-open range, after its
 * per-occurrence overrides.
 *
 * An occurrence is placed by the date it lands on, so one moved into the
 * range from outside it is included and one moved out is not. Skipped
 * occurrences are left out. Overrides keyed by a date that is not one of the
 * schedule's are ignored.
 *
 * @param item - The item, with any `overrides`.
 * @param from - First day to include, `YYYY-MM-DD`.
 * @param to - First day to exclude, `YYYY-MM-DD`.
 * @returns Occurrences ordered by the date they land, then nominal date.
 * @throws {RangeError} If the schedule, a date, an override date or `to` is invalid.
 */
export function scheduledOccurrences(item: RecurringItem, from: string, to: string): ScheduledOccurrence[] {
  const overrides = item.overrides ?? {}
  const found: ScheduledOccurrence[] = []
  const seen = new Set<string>()

  for (const nominalDate of occurrences(item, from, to)) {
    seen.add(nominalDate)
    const placed = place(item, nominalDate, overrides[nominalDate])
    if (placed !== null && placed.date >= from && placed.date < to) found.push(placed)
  }
  // Occurrences scheduled outside the range but moved into it.
  for (const [nominalDate, override] of Object.entries(overrides)) {
    if (seen.has(nominalDate) || override.date == null) continue
    const date = checkedDate(override.date, nominalDate)
    if (date < from || date >= to || !isScheduled(item, nominalDate)) continue
    const placed = place(item, nominalDate, override)
    if (placed !== null) found.push(placed)
  }

  return found.sort((a, b) =>
    a.date === b.date ? compare(a.nominalDate, b.nominalDate) : compare(a.date, b.date))
}

/**
 * The first occurrence that lands on or after a date and still moves money,
 * after overrides. Skipped occurrences and ones whose override leaves no legs
 * are passed over.
 *
 * @param item - The item, with any `overrides`.
 * @param from - Earliest date to consider, inclusive, `YYYY-MM-DD`.
 * @returns The occurrence, or `null` if none is left.
 * @throws {RangeError} If the schedule, a date or an override date is invalid.
 */
export function nextScheduledOccurrence(item: RecurringItem, from: string): ScheduledOccurrence | null {
  const overrides = item.overrides ?? {}
  let best: ScheduledOccurrence | null = null
  const consider = (candidate: ScheduledOccurrence | null) => {
    if (candidate === null || candidate.legs.length === 0 || candidate.date < from) return
    if (best === null || candidate.date < best.date
      || (candidate.date === best.date && candidate.nominalDate < best.nominalDate)) best = candidate
  }

  // Every overridden occurrence, wherever it was scheduled: it may have moved past `from`.
  for (const [nominalDate, override] of Object.entries(overrides)) {
    if (override.date != null) checkedDate(override.date, nominalDate)
    if (isScheduled(item, nominalDate)) consider(place(item, nominalDate, override))
  }
  // The first nominal occurrence on or after `from` that nothing overrides.
  // Each overridden one is stepped over, so this ends within overrides + 1 steps.
  for (let cursor: string | null = from; cursor !== null;) {
    const nominalDate: string | null = nextOccurrence(item, cursor)
    if (nominalDate === null) break
    if (!Object.hasOwn(overrides, nominalDate)) {
      consider({ nominalDate, date: nominalDate, legs: item.legs })
      break
    }
    cursor = fromDayNumber(toDayNumber(nominalDate) + 1)
  }
  return best
}

/** Applies one occurrence's override; `null` when it is skipped. */
function place(item: RecurringItem, nominalDate: string, override: OccurrenceOverride | undefined): ScheduledOccurrence | null {
  if (override === undefined) return { nominalDate, date: nominalDate, legs: item.legs }
  if (override.skipped === true) return null
  return {
    nominalDate,
    date: override.date == null ? nominalDate : checkedDate(override.date, nominalDate),
    legs: override.legs ?? item.legs,
  }
}

/** Whether `date` is one of the schedule's nominal dates. */
function isScheduled(item: RecurringItem, date: string): boolean {
  const day = toDayNumber(date, 'override key')
  return occurrences(item, date, fromDayNumber(day + 1)).length === 1
}

/** Validates an override's date, naming the occurrence in the error. */
function checkedDate(date: string, nominalDate: string): string {
  toDayNumber(date, `override date for ${nominalDate}`)
  return date
}

/** String order, which is date order for `YYYY-MM-DD`. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
