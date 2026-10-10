import { addDays } from '@wickermoney/plugin-sdk/date'
import { dailyBalances, monthlyEquivalent, nextPayday, nextScheduledOccurrence, occurrences, scheduledOccurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { RecurringItem } from '@wickermoney/plugin-sdk/recurrence'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { Repositories } from '../../data/Repositories.js'
import { todayIn } from '../../core/service/todayIn.js'
import { NotFoundError, ValidationError } from '../../errors.js'
import { addMoney, money, negate, toMoney } from '../../money.js'
import type { OccurrenceFilter } from '../repository/RecurringOccurrenceRepository.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { DEFAULT_FORECAST_HORIZON, type ForecastHorizon } from './FORECAST_HORIZONS.js'
import { forecastStats } from './forecastStats.js'
import type { ForecastAccount, ForecastEntry, ForecastView } from './ForecastView.js'
import { headlineAmount } from './headlineAmount.js'
import { toOccurrenceView } from './toOccurrenceView.js'
import { horizonEnd } from './horizonEnd.js'
import { LATE_DAYS, MAX_MOVE_DAYS } from './OCCURRENCE_RULES.js'
import {
  describeOccurrence, groupHistories, projectedItem, type ItemHistory,
} from './occurrenceState.js'
import type { OccurrenceView } from './OccurrenceView.js'
import type { RecurringItemInput } from './RecurringItemInput.js'
import type { RecurringItemView } from './RecurringItemView.js'
import type { UpcomingAccount, UpcomingView } from './UpcomingView.js'
import { toSchedule } from './toSchedule.js'
import { validateRecurringItem } from './validateRecurringItem.js'

/** Days an occurrences request covers when the caller gives no `to`. */
export const DEFAULT_WINDOW_DAYS = 31
/** How far the upcoming window reaches when no income is expected: two weeks, inclusive of the last day. */
export const FALLBACK_WINDOW_DAYS = 14
/** The widest occurrences range allowed: a little over a year keeps a daily item's response bounded. */
export const MAX_WINDOW_DAYS = 400

/** The name the legs trigger reports violations under (migration 021). */
const LEGS_RULE = 'ck_recurring_items_legs_match_kind'

/**
 * Monthly rates across the active items listed, for summary tiles.
 *
 * Transfers are excluded: moving money between your own accounts is neither
 * income nor spending. Debt payments count with bills, because from the
 * household's cash they are money going out.
 */
export interface RecurringSummary {
  /** Sum of income items' monthly equivalents (zero or positive). */
  readonly monthlyIncome: string
  /** Sum of bills' and debt payments' monthly equivalents, as a negative amount. */
  readonly monthlyOutgoings: string
  /** `monthlyIncome + monthlyOutgoings`. */
  readonly monthlyNet: string
}

/** Items plus the day they were evaluated against. */
export interface RecurringItemList {
  /** The user's today, `YYYY-MM-DD`, in their time zone. Everything derived was computed against it. */
  readonly today: string
  readonly items: readonly RecurringItemView[]
  /** Computed over the listed items that still occur; ended ones have no rate going forward. */
  readonly summary: RecurringSummary
}

/** Occurrences in a half-open range plus the day it was evaluated against. */
export interface OccurrenceList {
  readonly today: string
  /** First day included. */
  readonly from: string
  /** First day excluded. */
  readonly to: string
  /** Ordered by date, then item name. */
  readonly occurrences: readonly OccurrenceView[]
}

/**
 * Recurring items: CRUD, plus everything derived from "today".
 *
 * "Today" is the user's calendar day in `users.timezone`, worked out once per
 * call here at the edge and passed into the SDK's pure date maths, then
 * returned alongside the results so a client never has to work it out again
 * from its own clock (which may be in another zone, or the other side of
 * midnight).
 */
export class RecurringItemService {
  /**
   * @param uow - Unit of work.
   * @param now - Clock, injectable so tests can pin "today".
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Lists the user's items with their derived next due date.
   *
   * @param userId - The signed-in user.
   * @param options - `includeEnded` keeps items with no occurrence left (ended
   *   series, past one-offs); `accountId` keeps only items with a leg on that
   *   account, which is what an account's delete or merge dialog lists.
   * @returns Items ordered by next due date (ended last), then name.
   */
  list(userId: string, options: { includeEnded?: boolean; accountId?: string } = {}): Promise<RecurringItemList> {
    const { includeEnded = false, accountId } = options
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const history = await loadHistories(repos, { from: historyStart(today) })
        const items = (await repos.recurringItems.list())
          .map((row) => view(row, today, history(row.id)))
          .filter((item) => includeEnded || item.nextDue !== null)
          .filter((item) => accountId === undefined || item.legs.some((l) => l.accountId === accountId))
          .sort(byNextDue)
        return { today, items, summary: summarize(items) }
      },
      { readOnly: true },
    )
  }

  /**
   * Gets one item.
   *
   * @param userId - The signed-in user.
   * @param id - Item id.
   * @returns The item.
   * @throws {NotFoundError} If it does not exist for this user.
   */
  get(userId: string, id: string): Promise<RecurringItemView> {
    return this.uow.forUser(userId, (repos) => this.load(repos, userId, id), { readOnly: true })
  }

  /**
   * Creates an item and its legs.
   *
   * @param userId - The signed-in user.
   * @param input - The item.
   * @returns The created item.
   * @throws {ValidationError} If the item breaks a rule (see `validateRecurringItem`).
   */
  create(userId: string, input: RecurringItemInput): Promise<RecurringItemView> {
    return this.write(userId, async (repos) => {
      const item = await this.validate(repos, input)
      const id = await repos.recurringItems.insert(userId, item)
      return this.load(repos, userId, id)
    })
  }

  /**
   * Rewrites an item and its legs. Edits rewrite the whole series; to change
   * something only from now on, end this item and create another.
   *
   * @param userId - The signed-in user.
   * @param id - Item id.
   * @param input - The item as it should now be.
   * @returns The updated item.
   * @throws {NotFoundError} If it does not exist for this user.
   * @throws {ValidationError} If the item breaks a rule.
   */
  update(userId: string, id: string, input: RecurringItemInput): Promise<RecurringItemView> {
    return this.write(userId, async (repos) => {
      const item = await this.validate(repos, input)
      if (!(await repos.recurringItems.replace(userId, id, item))) throw new NotFoundError('Recurring item')
      // One occurrence's amount on a leg that is gone, or that changed
      // direction, no longer means anything.
      await repos.recurringOccurrences.pruneAmounts(id)
      return this.load(repos, userId, id)
    })
  }

  /**
   * Ends a series: no occurrence after `endDate`.
   *
   * @param userId - The signed-in user.
   * @param id - Item id.
   * @param endDate - Last date an occurrence may fall on; defaults to the user's today.
   * @returns The updated item.
   * @throws {NotFoundError} If it does not exist for this user.
   * @throws {ValidationError} If `endDate` is before the series starts.
   */
  end(userId: string, id: string, endDate?: string): Promise<RecurringItemView> {
    return this.write(userId, async (repos) => {
      const existing = await repos.recurringItems.find(id)
      if (existing === undefined) throw new NotFoundError('Recurring item')
      const last = endDate ?? (await this.today(repos, userId))
      if (last < existing.series_start_date) {
        throw new ValidationError(
          `endDate: This series starts on ${existing.series_start_date}, after ${last}. Delete it instead of ending it.`,
        )
      }
      await repos.recurringItems.setEndDate(id, last)
      return this.load(repos, userId, id)
    })
  }

  /**
   * Deletes an item and its legs.
   *
   * @param userId - The signed-in user.
   * @param id - Item id.
   * @throws {NotFoundError} If it does not exist for this user.
   */
  async delete(userId: string, id: string): Promise<void> {
    const gone = await this.uow.forUser(userId, (repos) => repos.recurringItems.delete(id))
    if (!gone) throw new NotFoundError('Recurring item')
  }

  /**
   * Lists every occurrence of every item expected in a half-open range, with
   * where each stands (settled, skipped, late...).
   *
   * An occurrence is listed by its expected date, so one moved into the range
   * is included and one moved out is not. Skipped occurrences are listed on
   * their nominal date, so they can be found to un-skip.
   *
   * @param userId - The signed-in user.
   * @param range - `from` defaults to the user's today; `to` to {@link DEFAULT_WINDOW_DAYS} after `from`;
   *   `itemId` keeps one item's occurrences.
   * @returns The occurrences and the range and today they were computed for.
   * @throws {ValidationError} If `to` is before `from` or the range exceeds {@link MAX_WINDOW_DAYS}.
   */
  occurrences(userId: string, range: { from?: string; to?: string; itemId?: string } = {}): Promise<OccurrenceList> {
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const from = range.from ?? today
        const to = range.to ?? addDays(from, DEFAULT_WINDOW_DAYS)
        if (to < from) throw new ValidationError('to: Must be on or after the start of the range.')
        if (to > addDays(from, MAX_WINDOW_DAYS)) {
          throw new ValidationError(`to: The range may cover at most ${MAX_WINDOW_DAYS} days.`)
        }

        // Look a month either side: an occurrence may have been moved in.
        const scanFrom = addDays(from, -MAX_MOVE_DAYS)
        const scanTo = addDays(to, MAX_MOVE_DAYS)
        const filter = { from: scanFrom, to: scanTo, ...(range.itemId === undefined ? {} : { itemId: range.itemId }) }
        const history = await loadHistories(repos, filter)
        const rows = (await repos.recurringItems.list()).filter((r) => range.itemId === undefined || r.id === range.itemId)

        const found: OccurrenceView[] = []
        for (const row of rows) {
          const h = history(row.id)
          for (const nominalDate of occurrences(toSchedule(row), scanFrom, scanTo)) {
            const state = describeOccurrence(row, h, nominalDate, today)
            if (state.expectedDate >= from && state.expectedDate < to) found.push(toOccurrenceView(row, state, state.expectedDate))
          }
        }
        return { today, from, to, occurrences: found.sort(byDateThenName) }
      },
      { readOnly: true },
    )
  }

  /**
   * What is coming up before the next payday, and whether each account the
   * user spends from makes it there above its buffer.
   *
   * The rules (decided in the recurring-items decisions record):
   * - The window runs from tomorrow — today's actual balance is the starting
   *   point, so nothing that already posted is counted twice — through the
   *   household's next payday, inclusive: the earliest income into any
   *   account. With no income expected, it runs 14 days.
   * - Accounts shown: every checking account, plus any savings account the
   *   user marked spendable. Only spendable ones count toward safe to spend;
   *   a checking account that is not spendable (money set aside for yearly
   *   bills, say) is still projected and still reported short, because a
   *   bill bouncing there matters whether or not it is spending money.
   * - Each account is projected on its own; Yearly Expenses never covers
   *   Monthly Expenses. Transfers apply to both accounts they touch.
   * - The low point of each day assumes its outflows clear before its
   *   inflows, so rent due on payday is caught if the paycheck lands late.
   * - Headroom is the lowest point minus the account's buffer. Safe to spend
   *   is the sum of positive headrooms of counted accounts; a short account
   *   is reported on its own and never netted away.
   * - What is recorded about single occurrences applies (see
   *   `projectedItem`): skipped ones are left out, money that already arrived
   *   is not projected again, and on an item that is matched, an occurrence
   *   that is late is still expected and lands on the window's first day.
   *
   * @param userId - The signed-in user.
   * @returns The window, per-account outlook, safe-to-spend and the occurrences in the window.
   */
  upcoming(userId: string): Promise<UpcomingView> {
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const from = addDays(today, 1)
        const rows = await repos.recurringItems.list()
        const history = await loadHistories(repos, { from: historyStart(today) })
        const items = rows.map((row) => projectedItem(row, history(row.id), today, from))

        const payday = nextPayday(items, today)
        const through = payday ?? addDays(today, FALLBACK_WINDOW_DAYS)
        const to = addDays(through, 1)

        const shown = (await repos.accounts.listWithBalances(false))
          .filter((a) => a.account_type === 'checking' || a.spendable)
          // Counted accounts first: they make up the headline number.
          .sort((a, b) => Number(b.spendable) - Number(a.spendable) || a.name.localeCompare(b.name))
        const series = dailyBalances(items, Object.fromEntries(shown.map((a) => [a.id, a.balance])), from, to)

        const accounts: UpcomingAccount[] = shown.map((a) => {
          let lowest = { date: today, balance: toMoney(a.balance) }
          for (const day of series[a.id] ?? []) {
            if (money(day.low).lessThan(lowest.balance)) lowest = { date: day.date, balance: day.low }
          }
          const headroom = toMoney(money(lowest.balance).minus(a.buffer_amount))
          return {
            accountId: a.id, name: a.name, balance: toMoney(a.balance), buffer: toMoney(a.buffer_amount),
            lowest, headroom, short: money(headroom).isNegative() && !money(headroom).isZero(),
            counted: a.spendable,
          }
        })
        const safeToSpend = addMoney('0', ...accounts.filter((a) => a.counted && !a.short).map((a) => a.headroom))

        const found: OccurrenceView[] = []
        rows.forEach((row, i) => {
          for (const placed of scheduledOccurrences(items[i] as RecurringItem, from, to)) {
            const state = describeOccurrence(row, history(row.id), placed.nominalDate, today)
            found.push(toOccurrenceView(row, state, placed.date))
          }
        })
        found.sort(byDateThenName)

        return {
          today,
          window: { from, through, payday },
          safeToSpend,
          accounts,
          occurrences: found,
          hasItems: rows.length > 0,
        }
      },
      { readOnly: true },
    )
  }

  /**
   * One account's projected daily balance, today through the horizon, from
   * its recurring items.
   *
   * Built the same way as {@link upcoming}: the projection starts from
   * today's actual balance and runs from tomorrow, every leg on the account
   * applies (both sides of a transfer), and each day carries its low point
   * with outflows clearing before inflows. Breaches and day counts are read
   * from those lows. Nothing here knows about transactions that have not
   * happened yet beyond the recurring items, so the line is "what the
   * schedule says", not a prediction from spending history.
   *
   * @param userId - The signed-in user.
   * @param options - `accountId` picks the account (default: the first
   *   spendable checking account, then any checking account, then the first
   *   account); `horizon` how far to look (default {@link DEFAULT_FORECAST_HORIZON}).
   * @returns The forecast.
   * @throws {NotFoundError} If `accountId` is not one of the user's active accounts.
   */
  forecast(userId: string, options: { accountId?: string; horizon?: ForecastHorizon } = {}): Promise<ForecastView> {
    const horizon = options.horizon ?? DEFAULT_FORECAST_HORIZON
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const from = addDays(today, 1)
        const through = horizonEnd(today, horizon)
        const window = { from, through }

        const active = await repos.accounts.listWithBalances(false)
        const accounts = active.map((a) => ({ accountId: a.id, name: a.name, accountType: a.account_type }))
        const rows = await repos.recurringItems.list()
        const hasItems = rows.length > 0

        const chosen = options.accountId === undefined
          ? defaultForecastAccount(active)
          : active.find((a) => a.id === options.accountId)
        if (chosen === undefined) {
          if (options.accountId !== undefined) throw new NotFoundError('Account')
          return { today, horizon, window, accounts, account: null, days: [], stats: null, entries: [], hasItems }
        }

        const cash = chosen.account_type === 'checking' || chosen.account_type === 'savings'
        const account: ForecastAccount = {
          accountId: chosen.id, name: chosen.name, accountType: chosen.account_type,
          balance: toMoney(chosen.balance), buffer: toMoney(chosen.buffer_amount), cash,
        }

        const touching = rows.filter((row) => row.legs.some((l) => l.account_id === chosen.id))
        const history = await loadHistories(repos, { from: historyStart(today) })
        const items = touching.map((row) => projectedItem(row, history(row.id), today, from))
        const to = addDays(through, 1)
        const days = dailyBalances(items, { [chosen.id]: chosen.balance }, from, to)[chosen.id] ?? []

        const entries: ForecastEntry[] = []
        touching.forEach((row, i) => {
          for (const placed of scheduledOccurrences(items[i] as RecurringItem, from, to)) {
            const state = describeOccurrence(row, history(row.id), placed.nominalDate, today)
            entries.push({
              itemId: row.id, date: placed.date, nominalDate: placed.nominalDate, status: state.status,
              name: row.name, kind: row.kind,
              // Only what is still to come moves the line: a leg already settled adds nothing.
              amount: addMoney('0', ...placed.legs.filter((l) => l.accountId === chosen.id).map((l) => l.amount)),
              legs: state.legs.map((l) => ({ accountId: l.accountId, amount: l.amount })),
            })
          }
        })
        entries.sort(byDateThenName)

        return {
          today, horizon, window, accounts, account, days,
          stats: forecastStats(today, chosen.balance, chosen.buffer_amount, cash, days),
          entries, hasItems,
        }
      },
      { readOnly: true },
    )
  }

  /** The user's today in their time zone. */
  private async today(repos: Repositories, userId: string): Promise<string> {
    const timezone = (await repos.reports.findTimezone(userId)) ?? 'UTC'
    return todayIn(timezone, this.now())
  }

  /** Loads an item and derives its view. */
  private async load(repos: Repositories, userId: string, id: string): Promise<RecurringItemView> {
    const row = await repos.recurringItems.find(id)
    if (row === undefined) throw new NotFoundError('Recurring item')
    const today = await this.today(repos, userId)
    const history = await loadHistories(repos, { itemId: id, from: historyStart(today) })
    return view(row, today, history(id))
  }

  /** Validates input against the user's accounts and categories. */
  private async validate(repos: Repositories, input: RecurringItemInput) {
    const accounts = await repos.recurringItems.findAccounts(input.legs.map((l) => l.accountId))
    const categoryId = input.categoryId ?? null
    const categoryKind = categoryId === null ? undefined : await repos.recurringItems.findCategoryKind(categoryId)
    return validateRecurringItem(input, accounts, categoryKind)
  }

  /**
   * Runs a write, translating a legs-trigger violation into a validation
   * error. Validation should have caught it first; this is the backstop for a
   * rule the service and the database disagree on, which would otherwise be a
   * 500 at commit.
   */
  private async write<T>(userId: string, work: (repos: Repositories) => Promise<T>): Promise<T> {
    try {
      return await this.uow.forUser(userId, work)
    } catch (error) {
      const pg = error as { code?: string; constraint?: string }
      if (pg.code === '23514' && pg.constraint === LEGS_RULE) {
        throw new ValidationError('legs: The legs do not have the shape this kind of item requires.')
      }
      throw error
    }
  }
}

/**
 * The account a forecast opens on when none is named: the first spendable
 * checking account (the one "Until payday" counts first), then any checking
 * account, then any spendable one, then the first account by name.
 */
function defaultForecastAccount<T extends { account_type: string; spendable: boolean }>(
  accounts: readonly T[],
): T | undefined {
  return accounts.find((a) => a.account_type === 'checking' && a.spendable)
    ?? accounts.find((a) => a.account_type === 'checking')
    ?? accounts.find((a) => a.spendable)
    ?? accounts[0]
}

/** Derives an item's view against today. */
function view(row: RecurringItemRow, today: string, history: ItemHistory): RecurringItemView {
  const legs = row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount }))
  const amount = headlineAmount(row.kind, legs)
  const late = history.tracked
    ? occurrences(toSchedule(row), addDays(today, -LATE_DAYS), today)
      .filter((date) => describeOccurrence(row, history, date, today).status === 'late')
    : []
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    frequency: row.frequency,
    seriesStartDate: row.series_start_date,
    endDate: row.end_date,
    semimonthlyDays:
      row.semimonthly_day_1 === null || row.semimonthly_day_2 === null
        ? null
        : [row.semimonthly_day_1, row.semimonthly_day_2],
    categoryId: row.category_id,
    legs,
    amount,
    monthlyEquivalent: monthlyEquivalent(amount, row.frequency),
    nextDue: nextScheduledOccurrence(projectedItem(row, history, today, null), today)?.date ?? null,
    tracked: history.tracked,
    late,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Sums the active items' monthly rates by direction, leaving transfers out. */
function summarize(items: readonly RecurringItemView[]): RecurringSummary {
  const active = items.filter((i) => i.nextDue !== null)
  const monthlyIncome = addMoney('0', ...active.filter((i) => i.kind === 'income').map((i) => i.monthlyEquivalent))
  const monthlyOutgoings = addMoney(
    '0',
    ...active.filter((i) => i.kind === 'bill').map((i) => i.monthlyEquivalent),
    // A debt payment's headline amount is what it moves (positive); from the
    // household's cash it is an outgoing.
    ...active.filter((i) => i.kind === 'debt_payment').map((i) => negate(i.monthlyEquivalent)),
  )
  return { monthlyIncome, monthlyOutgoings, monthlyNet: addMoney(monthlyIncome, monthlyOutgoings) }
}

/** Next due ascending, ended items last, then name. */
function byNextDue(a: RecurringItemView, b: RecurringItemView): number {
  if (a.nextDue !== b.nextDue) {
    if (a.nextDue === null) return 1
    if (b.nextDue === null) return -1
    return a.nextDue < b.nextDue ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

/**
 * The earliest nominal date whose record can still matter today: a late
 * occurrence (up to {@link LATE_DAYS} ago) that was also moved by up to
 * {@link MAX_MOVE_DAYS}.
 */
function historyStart(today: string): string {
  return addDays(today, -(LATE_DAYS + MAX_MOVE_DAYS))
}

/** Reads occurrence records and links and groups them by item. */
async function loadHistories(repos: Repositories, filter: OccurrenceFilter): Promise<(itemId: string) => ItemHistory> {
  const records = await repos.recurringOccurrences.listRecords(filter)
  const links = await repos.recurringOccurrences.listLinks(filter)
  const starts = await repos.recurringOccurrences.trackingStarts()
  return groupHistories(records, links, starts)
}

/** Date ascending, then name. */
function byDateThenName(a: { date: string; name: string }, b: { date: string; name: string }): number {
  return a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1
}
