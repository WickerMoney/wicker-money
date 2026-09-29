import { monthlyEquivalent, nextOccurrence, occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import type { Repositories } from '../../data/Repositories.js'
import { todayIn } from '../../core/service/todayIn.js'
import { NotFoundError, ValidationError } from '../../errors.js'
import { addMoney } from '../../money.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { addDays } from './addDays.js'
import type { OccurrenceView } from './OccurrenceView.js'
import type { RecurringItemInput } from './RecurringItemInput.js'
import type { RecurringItemView } from './RecurringItemView.js'
import { toSchedule } from './toSchedule.js'
import { validateRecurringItem } from './validateRecurringItem.js'

/** Days an occurrences request covers when the caller gives no `to`. */
export const DEFAULT_WINDOW_DAYS = 31
/** The widest occurrences range allowed: a little over a year keeps a daily item's response bounded. */
export const MAX_WINDOW_DAYS = 400

/** The name the legs trigger reports violations under (migration 021). */
const LEGS_RULE = 'ck_recurring_items_legs_match_kind'

/** Items plus the day they were evaluated against. */
export interface RecurringItemList {
  /** The user's today, `YYYY-MM-DD`, in their time zone. Everything derived was computed against it. */
  readonly today: string
  readonly items: readonly RecurringItemView[]
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
   * @param includeEnded - Include items with no occurrence left (ended series, past one-offs).
   * @returns Items ordered by next due date (ended last), then name.
   */
  list(userId: string, includeEnded = false): Promise<RecurringItemList> {
    return this.uow.forUser(
      userId,
      async (repos) => {
        const today = await this.today(repos, userId)
        const items = (await repos.recurringItems.list())
          .map((row) => view(row, today))
          .filter((item) => includeEnded || item.nextDue !== null)
          .sort(byNextDue)
        return { today, items }
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
          for (const date of occurrences(toSchedule(row), from, to)) {
            found.push({ itemId: row.id, date, name: row.name, kind: row.kind, categoryId: row.category_id, legs })
          }
        }
        found.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1))
        return { today, from, to, occurrences: found }
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
    const categoryExists = categoryId === null ? true : (await repos.recurringItems.findCategoryIds([categoryId])).has(categoryId)
    return validateRecurringItem(input, accounts, categoryExists)
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

/** Next due ascending, ended items last, then name. */
function byNextDue(a: RecurringItemView, b: RecurringItemView): number {
  if (a.nextDue !== b.nextDue) {
    if (a.nextDue === null) return 1
    if (b.nextDue === null) return -1
    return a.nextDue < b.nextDue ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}
