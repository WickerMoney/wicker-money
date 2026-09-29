import {
  dailyBalances, monthlyEquivalent, nextOccurrence, nextPayday, occurrences,
} from '@wickermoney/plugin-sdk/recurrence'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { Repositories } from '../../data/Repositories.js'
import { todayIn } from '../../core/service/todayIn.js'
import { NotFoundError, ValidationError } from '../../errors.js'
import { addMoney, money, negate, toMoney } from '../../money.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { addDays } from './addDays.js'
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
        const items = (await repos.recurringItems.list())
          .map((row) => view(row, today))
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
   * Lists every occurrence of every item in a half-open range.
   *
   * @param userId - The signed-in user.
   * @param range - `from` defaults to the user's today; `to` to {@link DEFAULT_WINDOW_DAYS} after `from`.
   * @returns The occurrences and the range and today they were computed for.
   * @throws {ValidationError} If `to` is before `from` or the range exceeds {@link MAX_WINDOW_DAYS}.
   */
  occurrences(userId: string, range: { from?: string; to?: string } = {}): Promise<OccurrenceList> {
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const from = range.from ?? today
        const to = range.to ?? addDays(from, DEFAULT_WINDOW_DAYS)
        if (to < from) throw new ValidationError('to: Must be on or after from.')
        if (to > addDays(from, MAX_WINDOW_DAYS)) {
          throw new ValidationError(`to: The range may cover at most ${MAX_WINDOW_DAYS} days.`)
        }

        const found: OccurrenceView[] = []
        for (const row of await repos.recurringItems.list()) {
          const legs = row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount }))
          const amount = headlineAmount(row)
          for (const date of occurrences(toSchedule(row), from, to)) {
            found.push({ itemId: row.id, date, name: row.name, kind: row.kind, categoryId: row.category_id, amount, legs })
          }
        }
        found.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))
        return { today, from, to, occurrences: found }
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
   *
   * @param userId - The signed-in user.
   * @returns The window, per-account outlook, safe-to-spend and the occurrences in the window.
   */
  upcoming(userId: string): Promise<UpcomingView> {
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const rows = await repos.recurringItems.list()
        const items = rows.map((row) => ({
          ...toSchedule(row),
          legs: row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount })),
        }))

        const from = addDays(today, 1)
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

        const found: UpcomingView['occurrences'][number][] = []
        for (const row of rows) {
          const legs = row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount }))
          const amount = headlineAmount(row)
          for (const date of occurrences(toSchedule(row), from, to)) {
            found.push({ itemId: row.id, date, name: row.name, kind: row.kind, categoryId: row.category_id, amount, legs })
          }
        }
        found.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))

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

  /** The user's today in their time zone. */
  private async today(repos: Repositories, userId: string): Promise<string> {
    const timezone = (await repos.reports.findTimezone(userId)) ?? 'UTC'
    return todayIn(timezone, this.now())
  }

  /** Loads an item and derives its view. */
  private async load(repos: Repositories, userId: string, id: string): Promise<RecurringItemView> {
    const row = await repos.recurringItems.find(id)
    if (row === undefined) throw new NotFoundError('Recurring item')
    return view(row, await this.today(repos, userId))
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

/** Derives an item's view against today. */
function view(row: RecurringItemRow, today: string): RecurringItemView {
  const legs = row.legs.map((l) => ({ accountId: l.account_id, amount: l.amount }))
  const amount = headlineAmount(row)
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
    nextDue: nextOccurrence(toSchedule(row), today),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * One amount that stands for the item: what income brings in (all legs), what
 * a bill costs (its one negative leg), or what a transfer moves (its positive
 * leg — a transfer's legs net to zero, which says nothing).
 */
function headlineAmount(row: RecurringItemRow): string {
  if (row.kind === 'transfer' || row.kind === 'debt_payment') {
    return row.legs.find((l) => !l.amount.startsWith('-'))?.amount ?? '0.0000'
  }
  return addMoney(...row.legs.map((l) => l.amount))
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
