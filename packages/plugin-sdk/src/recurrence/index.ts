/**
 * @module
 * Recurring-item date maths and projections: when an item occurs, what it
 * costs per month, when the household is next paid, and what each account's
 * balance does in between.
 *
 * Pure and dependency-free: calendar dates in and out as `YYYY-MM-DD`
 * strings, money as `numeric(19,4)` decimal strings, no clock and no time
 * zone. The caller works out the user's today once, in their zone, and passes
 * it in. Ranges are half-open (`from` inclusive, `to` exclusive), like
 * `DashboardRange`.
 */
export { DEFAULT_SEMIMONTHLY_DAYS, RECURRENCE_FREQUENCIES } from './types.js'
export type {
  DailyBalance, FlowTotals, RecurrenceFrequency, RecurrenceSchedule, RecurringItem, RecurringLeg,
} from './types.js'
export { nextOccurrence, occurrences } from './schedule.js'
export {
  dailyBalances, flowTotals, monthlyEquivalent, nextPayday,
} from './projection.js'
