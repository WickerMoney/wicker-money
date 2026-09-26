/**
 * Duplicate detection.
 *
 * Two mechanisms, and the difference between them is the whole point:
 *
 * `external_id` is the source's own identifier for the transaction. When it is
 * present a match is a fact, so the row is skipped silently and the partial
 * unique index on `(account_id, external_id)` backs that up in the database.
 *
 * Without one, all that is left is amount + merchant + a date window, which is
 * a guess. Two identical coffees bought on the same day are indistinguishable
 * from one coffee imported twice, and silently dropping the second would lose a
 * real transaction. So a heuristic match is `needs-review`: shown to the user,
 * with the transaction it matched, and imported unless they say otherwise.
 */
export { MATCH_WINDOW_DAYS } from './MATCH_WINDOW_DAYS.js'
export type { RowStatus } from './RowStatus.js'
export type { ExistingTransaction } from './ExistingTransaction.js'
export type { ClassifiedRow } from './ClassifiedRow.js'
export type { ClassifySummary } from './ClassifySummary.js'
export { normalizeMoney } from './normalizeMoney.js'
export { sameMoney } from './sameMoney.js'
export { classifyRows } from './classifyRows.js'
export { summarize } from './summarize.js'
