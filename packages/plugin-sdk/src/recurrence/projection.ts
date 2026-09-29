import { fromDayNumber, toDayNumber } from './calendar.js'
import { divideRounded, formatMoney, parseMoney } from './money.js'
import { nextOccurrence, occurrences } from './schedule.js'
import type {
  DailyBalance, FlowTotals, RecurrenceFrequency, RecurringItem,
} from './types.js'

/**
 * Occurrences per month for each frequency, as an exact fraction.
 *
 * Exact rather than rounded: the old app used ×2.17 for biweekly, which put a
 * $370 item at $802.90 a month instead of $801.67. Daily uses a 365-day year,
 * matching weekly's 52 weeks. A one-off has no monthly rate.
 */
const PER_MONTH: Record<RecurrenceFrequency, readonly [numerator: bigint, denominator: bigint]> = {
  once: [0n, 1n],
  daily: [365n, 12n],
  weekly: [52n, 12n],
  biweekly: [26n, 12n],
  semimonthly: [24n, 12n],
  monthly: [1n, 1n],
  quarterly: [1n, 3n],
  annual: [1n, 12n],
}

/**
 * What an amount on a schedule costs (or earns) per month, for summaries.
 *
 * Used for "per month" tiles, where a quarterly bill and a weekly one need a
 * common unit. It is a rate, not a forecast: a month with three biweekly
 * paydays still really gets three.
 *
 * @param amount - Signed amount per occurrence, as a decimal string. For an
 *   item with several legs, pass the total of the legs you want counted.
 * @param frequency - How often it occurs.
 * @returns The signed monthly amount as a four-decimal string, rounded half
 *   away from zero. `'0.0000'` for `once`, which has no monthly rate.
 * @throws {RangeError} If `amount` is not a decimal or `frequency` is unknown.
 */
export function monthlyEquivalent(amount: string, frequency: RecurrenceFrequency): string {
  if (!Object.hasOwn(PER_MONTH, frequency)) {
    throw new RangeError(`Unknown recurrence frequency: ${JSON.stringify(frequency)}`)
  }
  const [numerator, denominator] = PER_MONTH[frequency]
  return formatMoney(divideRounded(parseMoney(amount) * numerator, denominator))
}

/**
 * Whether an item brings money into the household: it has legs and every leg
 * is positive. A bill has a negative leg and a transfer's legs net to zero, so
 * neither counts, while a paycheck split across accounts does.
 *
 * @param item - The item to test.
 * @returns `true` for income.
 */
function isIncome(item: RecurringItem): boolean {
  return item.legs.length > 0 && item.legs.every((leg) => parseMoney(leg.amount, 'leg amount') > 0n)
}

/**
 * The household's next payday: the earliest income, into any account, after today.
 *
 * Strictly after `today`, because today's actual balance already includes
 * anything that landed today. Every income item counts, so two people paid
 * biweekly on offset weeks give a payday every week.
 *
 * @param items - All of the user's recurring items; non-income items are ignored.
 * @param today - The user's today, `YYYY-MM-DD`, in their time zone.
 * @returns The date, or `null` when no income occurs after today (the caller
 *   chooses a fallback window).
 * @throws {RangeError} If any item or date is invalid.
 */
export function nextPayday(items: readonly RecurringItem[], today: string): string | null {
  const tomorrow = fromDayNumber(toDayNumber(today, 'today') + 1)
  let earliest: string | null = null
  for (const item of items) {
    if (!isIncome(item)) continue
    const next = nextOccurrence(item, tomorrow)
    if (next !== null && (earliest === null || next < earliest)) earliest = next
  }
  return earliest
}

/**
 * Projects end-of-day balances for a set of accounts over a half-open range.
 *
 * Each account starts from its balance at the end of the day before `from` —
 * for the widget, today's actual balance with `from` set to tomorrow, so
 * nothing that already posted is counted twice. Every leg that lands on a
 * listed account is applied, including both sides of a transfer; legs on
 * accounts not listed are ignored. Balances may go negative.
 *
 * Every day in the range is present for every account, including days with
 * no activity, so a chart can plot the series directly. Each day also carries
 * its `low`: the balance after that day's outflows but before its inflows.
 *
 * @param items - Recurring items to apply.
 * @param startingBalances - Balance per account id at the end of the day
 *   before `from`, as decimal strings. Only these accounts are projected.
 * @param from - First day to project, inclusive, `YYYY-MM-DD`.
 * @param to - First day not projected, `YYYY-MM-DD`.
 * @returns Each listed account id mapped to one `DailyBalance` per day, ascending.
 * @throws {RangeError} If any item, amount or date is invalid, or `to` is before `from`.
 */
export function dailyBalances(
  items: readonly RecurringItem[],
  startingBalances: Readonly<Record<string, string>>,
  from: string,
  to: string,
): Record<string, DailyBalance[]> {
  const first = toDayNumber(from, 'from')
  const last = toDayNumber(to, 'to')
  if (last < first) throw new RangeError(`Range end ${to} is before its start ${from}`)

  const accounts = new Map<string, bigint>()
  for (const [accountId, balance] of Object.entries(startingBalances)) {
    accounts.set(accountId, parseMoney(balance, `starting balance for ${accountId}`))
  }

  // Per account, the money out and the money in on each day offset from
  // `first`, kept apart so a day's low point can apply outflows first.
  const outs = new Map<string, bigint[]>()
  const ins = new Map<string, bigint[]>()
  for (const accountId of accounts.keys()) {
    outs.set(accountId, new Array<bigint>(last - first).fill(0n))
    ins.set(accountId, new Array<bigint>(last - first).fill(0n))
  }

  for (const item of items) {
    const dates = occurrences(item, from, to)
    for (const leg of item.legs) {
      const amount = parseMoney(leg.amount, 'leg amount')
      const series = (amount < 0n ? outs : ins).get(leg.accountId)
      if (!series) continue
      for (const date of dates) {
        const offset = toDayNumber(date) - first
        series[offset] = (series[offset] ?? 0n) + amount
      }
    }
  }

  const result: [string, DailyBalance[]][] = []
  for (const [accountId, start] of accounts) {
    let running = start
    const days: DailyBalance[] = []
    const out = outs.get(accountId) ?? []
    const into = ins.get(accountId) ?? []
    for (let offset = 0; offset < last - first; offset += 1) {
      const low = running + (out[offset] ?? 0n)
      running = low + (into[offset] ?? 0n)
      days.push({ date: fromDayNumber(first + offset), balance: formatMoney(running), low: formatMoney(low) })
    }
    result.push([accountId, days])
  }
  return Object.fromEntries(result)
}

/**
 * Totals the money entering and leaving a set of accounts over a half-open range.
 *
 * Only legs on the listed accounts count, and each occurrence is netted
 * across them before it is classed as in or out. So a transfer between two
 * listed accounts (checking to savings, with both listed) nets to zero and is
 * never spending, while the same transfer measured on checking alone is an
 * outflow. A payment from checking to a loan, with only cash accounts listed,
 * is an outflow.
 *
 * @param items - Recurring items to total.
 * @param accountIds - The accounts that make up "the household" for this total.
 * @param from - First day, inclusive, `YYYY-MM-DD`.
 * @param to - First day excluded, `YYYY-MM-DD`.
 * @returns Inflow, outflow and net as four-decimal strings.
 * @throws {RangeError} If any item, amount or date is invalid, or `to` is before `from`.
 */
export function flowTotals(
  items: readonly RecurringItem[],
  accountIds: readonly string[],
  from: string,
  to: string,
): FlowTotals {
  const inSet = new Set(accountIds)
  let inflow = 0n
  let outflow = 0n
  for (const item of items) {
    const dates = occurrences(item, from, to)
    let perOccurrence = 0n
    for (const leg of item.legs) {
      const amount = parseMoney(leg.amount, 'leg amount')
      if (inSet.has(leg.accountId)) perOccurrence += amount
    }
    const total = perOccurrence * BigInt(dates.length)
    if (total > 0n) inflow += total
    else outflow += total
  }
  return { inflow: formatMoney(inflow), outflow: formatMoney(outflow), net: formatMoney(inflow + outflow) }
}
