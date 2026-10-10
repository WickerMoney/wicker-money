import { addDays, occurrences, type OccurrenceOverride, type RecurringItem } from '@wickermoney/plugin-sdk/recurrence'
import { money } from '../../money.js'
import type { OccurrenceLinkRow } from '../repository/OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from '../repository/OccurrenceRecordRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { LATE_DAYS } from './OCCURRENCE_RULES.js'
import type { OccurrenceStatus } from './OccurrenceStatus.js'
import { toSchedule } from './toSchedule.js'

/** Everything recorded about one item's occurrences, keyed by nominal date. */
export interface ItemHistory {
  /** Whether any occurrence of the item has ever been settled by a transaction. */
  readonly tracked: boolean
  /**
   * The nominal date of the first occurrence ever settled, or `null` when
   * none has been. Occurrences before it are never late or missed: the user
   * was not matching yet.
   */
  readonly trackedSince: string | null
  readonly records: ReadonlyMap<string, OccurrenceRecordRow>
  readonly links: ReadonlyMap<string, readonly OccurrenceLinkRow[]>
}

/** A transaction settling one leg. */
export interface SettledBy {
  readonly id: string
  readonly date: string
  /** What actually posted, signed. */
  readonly amount: string
  readonly merchant: string
}

/** One leg of one occurrence. */
export interface OccurrenceLegState {
  readonly accountId: string
  /** What is expected on this account this time: the occurrence's amount if changed, else the item's. */
  readonly amount: string
  /** The transaction that settled it, or `null`. */
  readonly transaction: SettledBy | null
}

/** One occurrence after everything recorded about it. */
export interface OccurrenceState {
  readonly nominalDate: string
  /** When it is expected: the moved date, or the nominal one. */
  readonly expectedDate: string
  readonly status: OccurrenceStatus
  readonly legs: readonly OccurrenceLegState[]
  /** Whether it was moved off its nominal date. */
  readonly moved: boolean
  /** Whether any leg's amount differs from the item's this time. */
  readonly changed: boolean
}

/** An item with nothing recorded. */
export const EMPTY_HISTORY: ItemHistory = { tracked: false, trackedSince: null, records: new Map(), links: new Map() }

/**
 * Groups records and links by item, then by nominal date.
 *
 * @param records - Recorded occurrences.
 * @param links - Transactions settling occurrences.
 * @param trackingStarts - When matching started for each item matched at least once, ever
 *   (not only in the rows given).
 * @returns Each item's history; an item with no rows has {@link EMPTY_HISTORY} apart from its tracking start.
 */
export function groupHistories(
  records: readonly OccurrenceRecordRow[],
  links: readonly OccurrenceLinkRow[],
  trackingStarts: ReadonlyMap<string, string>,
): (itemId: string) => ItemHistory {
  const byItem = new Map<string, { records: Map<string, OccurrenceRecordRow>; links: Map<string, OccurrenceLinkRow[]> }>()
  const entry = (itemId: string) => {
    let found = byItem.get(itemId)
    if (found === undefined) {
      found = { records: new Map(), links: new Map() }
      byItem.set(itemId, found)
    }
    return found
  }
  for (const record of records) entry(record.recurring_item_id).records.set(record.nominal_date, record)
  for (const link of links) {
    const list = entry(link.recurring_item_id).links
    list.set(link.nominal_date, [...(list.get(link.nominal_date) ?? []), link])
  }
  return (itemId) => {
    const found = byItem.get(itemId)
    return {
      tracked: trackingStarts.has(itemId),
      trackedSince: trackingStarts.get(itemId) ?? null,
      records: found?.records ?? new Map(),
      links: found?.links ?? new Map(),
    }
  }
}

/**
 * Works out where one occurrence stands. See {@link OccurrenceStatus}.
 *
 * @param row - The item.
 * @param history - What is recorded about its occurrences.
 * @param nominalDate - The occurrence; the caller ensures it is on the schedule.
 * @param today - The user's today.
 * @returns The occurrence's state.
 */
export function describeOccurrence(
  row: RecurringItemRow,
  history: ItemHistory,
  nominalDate: string,
  today: string,
): OccurrenceState {
  const record = history.records.get(nominalDate)
  const links = history.links.get(nominalDate) ?? []
  const overrides = new Map((record?.legs ?? []).map((l) => [l.account_id, l.amount]))

  let changed = false
  const legs = row.legs.map((leg): OccurrenceLegState => {
    const override = overrides.get(leg.account_id)
    // An amount left from before an edit that flipped the leg's sign is
    // ignored, as the service prunes it on the next write.
    const usable = override !== undefined && override.startsWith('-') === leg.amount.startsWith('-')
    if (usable && !money(override).equals(money(leg.amount))) changed = true
    const link = links.find((l) => l.account_id === leg.account_id)
    return {
      accountId: leg.account_id,
      amount: usable ? override : leg.amount,
      transaction: link === undefined
        ? null
        : { id: link.transaction_id, date: link.transaction_date, amount: link.amount, merchant: link.merchant },
    }
  })

  const expectedDate = record?.expected_date ?? nominalDate
  const settled = legs.length > 0 && legs.every((l) => l.transaction !== null)
  let status: OccurrenceStatus
  if (record?.skipped === true) status = 'skipped'
  else if (settled) status = 'cleared'
  else if (expectedDate > today) status = 'upcoming'
  else if (history.trackedSince === null || nominalDate < history.trackedSince) status = 'assumed'
  else if (expectedDate === today) status = 'due'
  else if (expectedDate >= addDays(today, -LATE_DAYS)) status = 'late'
  else status = 'missed'

  return { nominalDate, expectedDate, status, legs, moved: expectedDate !== nominalDate, changed }
}

/**
 * The item as the SDK projects it: its schedule and legs plus one override
 * for every occurrence that differs from the series.
 *
 * - Skipped occurrences are skipped.
 * - Settled legs are left out, because their money is in today's balance
 *   already: a paycheck that arrived early is not counted again on payday.
 * - Moved occurrences land on their expected date; changed amounts apply.
 * - With `carryTo`, occurrences that are `due` or `late` land on that date
 *   (the first projected day): they are still coming, just not when planned.
 *   Without it they stay on their date, before any projection.
 *
 * @param row - The item.
 * @param history - What is recorded about its occurrences.
 * @param today - The user's today.
 * @param carryTo - The first projected day, or `null` to leave late occurrences where they are.
 * @returns The item for the SDK.
 */
export function projectedItem(
  row: RecurringItemRow,
  history: ItemHistory,
  today: string,
  carryTo: string | null,
): RecurringItem {
  const schedule = toSchedule(row)
  const legs = row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount }))

  const dates = new Set([...history.records.keys(), ...history.links.keys()])
  // A tracked item's recent occurrences may be late without anything recorded.
  if (history.tracked) {
    for (const date of occurrences(schedule, addDays(today, -LATE_DAYS), addDays(today, 1))) dates.add(date)
  }

  const overrides: Record<string, OccurrenceOverride> = {}
  for (const nominalDate of dates) {
    // Records or links left on a date the schedule no longer has are ignored here, as the SDK would.
    if (occurrences(schedule, nominalDate, addDays(nominalDate, 1)).length === 0) continue
    const state = describeOccurrence(row, history, nominalDate, today)
    if (state.status === 'skipped') {
      overrides[nominalDate] = { skipped: true }
      continue
    }
    const unsettled = state.legs.filter((l) => l.transaction === null)
    const carried = carryTo !== null && (state.status === 'due' || state.status === 'late')
    const date = carried ? carryTo : state.expectedDate
    const sameLegs = !state.changed && unsettled.length === legs.length
    if (date === nominalDate && sameLegs) continue
    overrides[nominalDate] = {
      ...(date === nominalDate ? {} : { date }),
      ...(sameLegs ? {} : { legs: unsettled.map((l) => ({ accountId: l.accountId, amount: l.amount })) }),
    }
  }
  return { ...schedule, legs, overrides }
}
