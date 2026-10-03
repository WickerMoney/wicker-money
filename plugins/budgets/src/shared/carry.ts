import {
  addMoney, isNegativeMoney, moneyToUnits, subtractMoney, ZERO_MONEY,
} from '@wickermoney/plugin-sdk/money'

/**
 * Carry-forward for rollover lines.
 *
 * Under the instance model, "does overspend carry?" is not a mode but a
 * formula: how instance N+1's opening balance derives from
 * instance N. There is nothing to toggle and nothing stored — the number is
 * recomputed from history every time it is read, so a transaction imported late
 * against an old month corrects every month after it automatically. Writing
 * the carry-forward into the next row would instead destroy the input it was
 * computed from.
 *
 * **Overspend carries as a negative, and that is a decision.** Clamping it
 * at zero (`GREATEST(0, allocated - spent)`) would mean going over never costs
 * anything the following month. For a sinking fund that is simply wrong: a car
 * maintenance envelope you overdrew has less in it, and a fund that refills
 * itself when you overspend is not a fund, it is a suggestion. Carrying the
 * negative is taken knowingly, because the instance model makes the consequence
 * visible and reversible rather than baked into a mutated row.
 *
 * Non-rollover lines carry nothing in either direction, which is what makes a
 * monthly allowance a monthly allowance.
 */

/** One month of a single category's history, oldest first. */
export interface HistoryEntry {
  /** The `YYYY-MM` month this entry describes. */
  readonly monthKey: string
  /** Amount planned for the month, as a decimal string. */
  readonly planned: string
  /** Amount spent in the month, as a decimal string. */
  readonly spent: string
  /** Whether this line's remaining balance carries into the next month. */
  readonly rollover: boolean
}

/** The computed fund position for one month of one category. */
export interface Balance {
  /** The `YYYY-MM` month this balance describes. */
  readonly monthKey: string
  /** Brought in from the previous month. Zero unless that month rolled over. */
  readonly carriedIn: string
  /** `planned + carriedIn` — what is actually available this month. */
  readonly available: string
  /** Amount spent in the month, as a decimal string. */
  readonly spent: string
  /** `available - spent`. Negative means overspent. */
  readonly remaining: string
}

/**
 * Walks a category's history forward, accumulating the fund balance.
 *
 * Forward rather than recursive-backward on purpose: every month depends on
 * every earlier one, so computing them in order is a single pass where the
 * obvious recursion is exponential without memoisation.
 *
 * A gap in the history — a month with no line at all — breaks the chain rather
 * than being treated as a zero-planned month. Two readings are defensible and
 * this is the conservative one: a month you never planned is a month you were
 * not running this envelope, and silently carrying a balance across it would
 * produce an opening figure the user never saw or agreed to.
 *
 * @param history - One category's months in ascending order, at most one entry per month.
 * @returns One {@link Balance} per input entry, in the same order.
 * @throws {RangeError} If any month key or amount is malformed.
 */
export function carryForward(history: readonly HistoryEntry[]): Balance[] {
  const out: Balance[] = []
  let pending: { monthKey: string; remaining: string } | null = null

  for (const entry of history) {
    const carriedIn =
      pending !== null && isConsecutive(pending.monthKey, entry.monthKey) ? pending.remaining : ZERO_MONEY

    const available = addMoney(entry.planned, carriedIn)
    const remaining = subtractMoney(available, entry.spent)

    out.push({ monthKey: entry.monthKey, carriedIn, available, spent: entry.spent, remaining })

    pending = entry.rollover ? { monthKey: entry.monthKey, remaining } : null
  }

  return out
}

/**
 * Looks up a single month's balance within a category's history.
 *
 * @param history - One category's months in ascending order.
 * @param monthKey - The `YYYY-MM` month wanted.
 * @returns That month's {@link Balance}, or `undefined` if the history has no entry for it.
 * @throws {RangeError} If any month key or amount in `history` is malformed.
 */
export function balanceFor(
  history: readonly HistoryEntry[],
  monthKey: string,
): Balance | undefined {
  return carryForward(history).find((b) => b.monthKey === monthKey)
}

/**
 * Tests whether a month ended below zero.
 *
 * @param balance - A computed month balance.
 * @returns `true` if `balance.remaining` is negative.
 */
export function isOverspent(balance: Balance): boolean {
  return isNegativeMoney(balance.remaining)
}

/**
 * What a line's planned amount should default to when drafting the next month.
 *
 * The plan repeats; the carry-forward does not, because it is derived. Copying
 * `available` here instead of `planned` would fold last month's leftover into
 * next month's *plan*, and then the month after would carry it again — the same
 * balance counted twice, every month, compounding.
 *
 * @param previous - The prior month's line.
 * @returns The prior month's planned amount, unchanged.
 */
export function draftPlannedFrom(previous: { planned: string }): string {
  return previous.planned
}

/** Tests whether `later` is the calendar month immediately after `earlier` (both `YYYY-MM`). */
function isConsecutive(earlier: string, later: string): boolean {
  const index = (key: string): number => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7))
  return index(later) - index(earlier) === 1
}

/**
 * Totals the planned amounts of a set of lines.
 *
 * @param lines - Lines each carrying a decimal-string `planned` amount.
 * @returns The sum as a four-decimal string.
 * @throws {RangeError} If any `planned` is not a decimal number.
 */
export function totalPlanned(lines: readonly { planned: string }[]): string {
  return lines.reduce((total, l) => addMoney(total, l.planned), ZERO_MONEY)
}

/**
 * Tests whether a string is acceptable as a planned amount.
 *
 * @param value - Candidate text, e.g. from an input field.
 * @returns `true` if it is a decimal with at most four places that is not
 *   negative; never throws. A fifth place is refused, as the API refuses it,
 *   rather than truncated into a plan the user never typed.
 */
export function isValidPlan(value: string): boolean {
  try {
    return moneyToUnits(value) >= 0n
  } catch {
    return false
  }
}
