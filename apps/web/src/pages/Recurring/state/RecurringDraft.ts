import type { RecurrenceFrequency, RecurringKind } from '../../../models/index.js'

/** One row of an income item's split. */
export interface SplitDraft {
  readonly accountId: string
  /** As typed; a positive amount. */
  readonly amount: string
}

/**
 * The add/edit form's state, as the user sees it: amounts are typed positive
 * and the kind decides their signs, so nobody has to type a minus sign for a
 * bill.
 */
export interface RecurringDraft {
  readonly name: string
  readonly kind: RecurringKind
  readonly frequency: RecurrenceFrequency
  /** The first date, `YYYY-MM-DD`. */
  readonly seriesStartDate: string
  /** `''` for no planned end. */
  readonly endDate: string
  /** Twice-a-month days, as strings from the selects. */
  readonly day1: string
  readonly day2: string
  /** `''` for none; only income and bills have one. */
  readonly categoryId: string
  /** Bills, transfers and debt payments: the amount, typed positive. */
  readonly amount: string
  /** Bills: the paying account. Transfers and debt payments: where money leaves. */
  readonly fromAccountId: string
  /** Transfers and debt payments: where money arrives. */
  readonly toAccountId: string
  /** Income: where each part of the money arrives. */
  readonly splits: readonly SplitDraft[]
}
