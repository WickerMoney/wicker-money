/**
 * @module
 * Calendar-date arithmetic on `YYYY-MM-DD` strings: `addDays` and `addMonths`.
 *
 * Dates here are calendar days, not instants: there is no time of day and no
 * time zone, so nothing can shift a day across midnight or a DST change. Pure
 * and dependency-free, so it is safe in the browser and in Node, and importing
 * it pulls in nothing else from the SDK.
 *
 * Stability: `@stable`. The two helpers are small and their behaviour is
 * settled (month-end clamping, `RangeError` for anything that is not a real
 * calendar date or a whole number).
 *
 * @stable
 */
export { addDays, addMonths } from './calendar.js'
