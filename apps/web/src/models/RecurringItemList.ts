import type { RecurringItem } from './RecurringItem.js'

/** `GET /recurring-items`: items, the day they were computed for, and monthly tiles. */
export interface RecurringItemList {
  /** The user's today in their time zone, as the server computed it. */
  readonly today: string
  readonly items: readonly RecurringItem[]
  readonly summary: {
    readonly monthlyIncome: string
    /** Negative. */
    readonly monthlyOutgoings: string
    readonly monthlyNet: string
  }
}
