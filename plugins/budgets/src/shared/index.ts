/**
 * Domain logic shared by both halves of the plugin.
 *
 * The server derives a month's figures from the ledger; the page renders them
 * and previews an edit before it is saved. Both need the same definitions of
 * "available", "on pace" and "overspent", and two implementations that agree
 * today are two implementations that disagree later — for example a `spent`
 * the server stored, a `spent` the SQL computed, and a third `spent` the
 * browser recalculated off a paginated list.
 *
 * One module, imported by both, is the whole prevention.
 */
export {
  monthPeriod, monthKeyOf, shiftMonth, previousMonth, daysInMonth, todayIn,
  elapsedFraction, isMonthKey, type Period,
} from './period.js'

export {
  parseMoney, formatMoney, editableMoney, addMoney, subtractMoney, sumMoney,
  negateMoney, compareMoney, isNegative, isZero, ratio,
} from './money.js'

export {
  carryForward, balanceFor, isOverspent, draftPlannedFrom, totalPlanned, isValidPlan,
  type Balance, type HistoryEntry,
} from './carry.js'

export {
  statusFor, statusAt, rankAtRisk, rankBreakdown, AT_RISK_PACE,
  type Health, type LineStatus, type StatusInput, type MonthSummary,
} from './pace.js'

export {
  isDate, addDays, isCalendarMonth, windowProblem, windowElapsed, asOfInMonth, windowMonth,
  MAX_WINDOW_MONTHS, type WindowMonth, type WindowMonthInput,
} from './window.js'
