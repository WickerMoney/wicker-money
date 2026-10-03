import { occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { todayIn } from '../../core/service/todayIn.js'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { addMoney, money } from '../../money.js'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { addDays } from './addDays.js'
import { MATCH_WINDOW_DAYS, rankCandidates, type MatchCandidate } from './matchCandidates.js'
import type { MatchSuggestion, MatchSuggestionList, OccurrenceCandidates } from './MatchSuggestion.js'
import { MAX_MOVE_DAYS } from './OCCURRENCE_RULES.js'
import type { OccurrenceOverrideInput } from './OccurrenceOverrideInput.js'
import { describeOccurrence, groupHistories, type ItemHistory, type OccurrenceState } from './occurrenceState.js'
import type { OccurrenceView } from './OccurrenceView.js'
import { toOccurrenceView } from './toOccurrenceView.js'
import { toSchedule } from './toSchedule.js'

/** How far back suggestions look: two weeks covers a late paycheck plus a missed weekly check-in. */
export const SUGGEST_LOOKBACK_DAYS = 14
/** How far ahead suggestions look, for money that arrives before its date. */
export const SUGGEST_LOOKAHEAD_DAYS = 5

/**
 * Single occurrences of recurring items: what the user records about one
 * (skip it, move it, change its amount) and which transactions settled it.
 *
 * An occurrence is identified by its item and nominal date, and is only
 * written down once something about it is recorded. Matching is always
 * confirmed by the user: candidates and suggestions are offered, never
 * applied, so a wrong guess can never quietly move safe to spend.
 */
export class RecurringOccurrenceService {
  /**
   * @param uow - Unit of work.
   * @param now - Clock, injectable so tests can pin "today".
   */
  constructor(
    private readonly uow: UnitOfWork,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Gets one occurrence and where it stands.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @returns The occurrence.
   * @throws {NotFoundError} If the item does not exist or has no occurrence on that date.
   */
  get(userId: string, itemId: string, nominalDate: string): Promise<OccurrenceView> {
    return this.uow.forUser(userId, async (repos) => {
      const row = await findOccurrence(repos, itemId, nominalDate)
      return this.view(repos, userId, row, nominalDate)
    }, { readOnly: true })
  }

  /**
   * Records how one occurrence differs from its series, replacing whatever
   * was recorded before. Sending `skipped: false, expectedDate: null, legs:
   * null` puts it back to the series.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @param input - What to record.
   * @returns The occurrence afterwards.
   * @throws {NotFoundError} If the item does not exist or has no occurrence on that date.
   * @throws {ValidationError} If the input breaks a rule (see {@link checkOverride}).
   * @throws {ConflictError} `occurrence_matched` when skipping an occurrence a transaction settles.
   */
  override(userId: string, itemId: string, nominalDate: string, input: OccurrenceOverrideInput): Promise<OccurrenceView> {
    return this.uow.forUser(userId, async (repos) => {
      const row = await findOccurrence(repos, itemId, nominalDate)
      const legs = checkOverride(row, nominalDate, input)
      const state = await this.state(repos, userId, row, nominalDate)
      if (input.skipped && state.legs.some((l) => l.transaction !== null)) {
        throw new ConflictError(
          'This occurrence has a transaction matched to it, so it happened. Unmatch the transaction to skip it.',
          'occurrence_matched',
        )
      }
      const id = await repos.recurringOccurrences.ensure(userId, itemId, nominalDate)
      const expectedDate = input.expectedDate === nominalDate ? null : input.expectedDate
      await repos.recurringOccurrences.write(userId, id, { skipped: input.skipped, expectedDate, legs })
      await repos.recurringOccurrences.deleteIfEmpty(id)
      return this.view(repos, userId, row, nominalDate)
    })
  }

  /**
   * Lists the transactions that could settle each unsettled leg of an
   * occurrence, best first. Nothing is linked.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @returns The occurrence and each unsettled leg's candidates.
   * @throws {NotFoundError} If the item does not exist or has no occurrence on that date.
   */
  candidates(userId: string, itemId: string, nominalDate: string): Promise<OccurrenceCandidates> {
    return this.uow.forUser(userId, async (repos) => {
      const today = await this.today(repos, userId)
      const row = await findOccurrence(repos, itemId, nominalDate)
      const state = await this.stateOn(repos, row, nominalDate, today)
      const open = state.legs.filter((l) => l.transaction === null)
      const rows = await repos.recurringOccurrences.findCandidates(
        open.map((l) => l.accountId),
        addDays(state.expectedDate, -MATCH_WINDOW_DAYS),
        addDays(state.expectedDate, MATCH_WINDOW_DAYS),
      )
      return {
        today,
        occurrence: toOccurrenceView(row, state, state.expectedDate),
        legs: open.map((leg) => ({
          accountId: leg.accountId,
          amount: leg.amount,
          candidates: rankCandidates(leg, state.expectedDate, rows),
        })),
      }
    }, { readOnly: true })
  }

  /**
   * Suggests the likeliest transaction for every unsettled leg of every
   * occurrence expected from two weeks ago to a few days ahead.
   *
   * Only confident candidates are suggested (close in date and amount; see
   * `rankCandidates`), and each transaction and each leg at most once, best
   * score first. Skipped occurrences are not considered.
   *
   * @param userId - The signed-in user.
   * @returns Suggestions, best first.
   */
  suggestions(userId: string): Promise<MatchSuggestionList> {
    return this.uow.forUser(userId, async (repos) => {
      const today = await this.today(repos, userId)
      const from = addDays(today, -SUGGEST_LOOKBACK_DAYS)
      const to = addDays(today, SUGGEST_LOOKAHEAD_DAYS + 1)
      const scan = { from: addDays(from, -MAX_MOVE_DAYS), to: addDays(to, MAX_MOVE_DAYS) }
      const history = groupHistories(
        await repos.recurringOccurrences.listRecords(scan),
        await repos.recurringOccurrences.listLinks(scan),
        await repos.recurringOccurrences.trackingStarts(),
      )

      const open: { row: RecurringItemRow; state: OccurrenceState; accountId: string; amount: string }[] = []
      for (const row of await repos.recurringItems.list()) {
        for (const nominalDate of occurrences(toSchedule(row), scan.from, scan.to)) {
          const state = describeOccurrence(row, history(row.id), nominalDate, today)
          if (state.status === 'skipped' || state.expectedDate < from || state.expectedDate >= to) continue
          for (const leg of state.legs) {
            if (leg.transaction === null) open.push({ row, state, accountId: leg.accountId, amount: leg.amount })
          }
        }
      }
      const accounts = [...new Set(open.map((o) => o.accountId))]
      const rows = await repos.recurringOccurrences.findCandidates(
        accounts, addDays(from, -MATCH_WINDOW_DAYS), addDays(to, MATCH_WINDOW_DAYS),
      )

      const pairs: { open: (typeof open)[number]; candidate: MatchCandidate }[] = []
      for (const o of open) {
        for (const candidate of rankCandidates(o, o.state.expectedDate, rows)) {
          if (candidate.confident) pairs.push({ open: o, candidate })
        }
      }
      pairs.sort((a, b) => a.candidate.score - b.candidate.score)

      const usedTransactions = new Set<string>()
      const usedLegs = new Set<string>()
      const suggestions: MatchSuggestion[] = []
      for (const { open: o, candidate } of pairs) {
        const leg = `${o.row.id}|${o.state.nominalDate}|${o.accountId}`
        if (usedTransactions.has(candidate.transactionId) || usedLegs.has(leg)) continue
        usedTransactions.add(candidate.transactionId)
        usedLegs.add(leg)
        suggestions.push({ occurrence: toOccurrenceView(o.row, o.state, o.state.expectedDate), accountId: o.accountId, candidate })
      }
      return { today, suggestions }
    }, { readOnly: true })
  }

  /**
   * Records that a transaction settled one leg of an occurrence.
   *
   * The transaction must be on an account the item has a leg on, in the
   * leg's direction, and not already settle another occurrence. One side of a
   * transfer brings the other with it when the other side is on the item's
   * other leg, since the two rows are one movement of money.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @param transactionId - The transaction.
   * @returns The occurrence afterwards.
   * @throws {NotFoundError} If the item, occurrence or transaction does not exist.
   * @throws {ValidationError} If the transaction is on the wrong account or goes the wrong way.
   * @throws {ConflictError} `already_matched` if it settles another occurrence, `leg_matched` if that leg
   *   is already settled, `occurrence_skipped` if the occurrence is skipped.
   */
  match(userId: string, itemId: string, nominalDate: string, transactionId: string): Promise<OccurrenceView> {
    return this.uow.forUser(userId, async (repos) => {
      const row = await findOccurrence(repos, itemId, nominalDate)
      const [tx] = await repos.recurringOccurrences.findTransactions([transactionId])
      if (tx === undefined) throw new NotFoundError('Transaction')

      const state = await this.state(repos, userId, row, nominalDate)
      if (state.legs.some((l) => l.transaction?.id === tx.id)) return this.view(repos, userId, row, nominalDate)
      if (tx.recurring_occurrence_id !== null) {
        throw new ConflictError('That transaction is already matched to another occurrence. Unmatch it there first.', 'already_matched')
      }
      if (state.status === 'skipped') {
        throw new ConflictError('This occurrence is skipped. Un-skip it before matching a transaction to it.', 'occurrence_skipped')
      }
      const leg = state.legs.find((l) => l.accountId === tx.account_id)
      if (leg === undefined) {
        throw new ValidationError('transactionId: That transaction is on an account this item does not use.')
      }
      checkDirection(leg.amount, tx)
      if (leg.transaction !== null) {
        throw new ConflictError('That leg of this occurrence is already matched. Unmatch it first.', 'leg_matched')
      }

      const linked = [tx.id]
      if (tx.transfer_id !== null) {
        const partner = (await repos.recurringOccurrences.findTransferRows(tx.transfer_id)).find((r) => r.id !== tx.id)
        const partnerLeg = partner && state.legs.find((l) => l.accountId === partner.account_id)
        if (partner && partnerLeg && partnerLeg.transaction === null && partner.recurring_occurrence_id === null
          && money(partner.amount).isNegative() === money(partnerLeg.amount).isNegative()) {
          linked.push(partner.id)
        }
      }
      const id = await repos.recurringOccurrences.ensure(userId, itemId, nominalDate)
      await repos.recurringOccurrences.setLink(linked, id)
      return this.view(repos, userId, row, nominalDate)
    })
  }

  /**
   * Removes a transaction from the occurrence it settles (and the other side
   * of a transfer, if it settles the same occurrence). Neither transaction
   * changes otherwise.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @param transactionId - The transaction.
   * @returns The occurrence afterwards.
   * @throws {NotFoundError} If the item or occurrence does not exist, or the transaction does not settle it.
   */
  unmatch(userId: string, itemId: string, nominalDate: string, transactionId: string): Promise<OccurrenceView> {
    return this.uow.forUser(userId, async (repos) => {
      const row = await findOccurrence(repos, itemId, nominalDate)
      const [record] = await repos.recurringOccurrences.listRecords({ itemId, from: nominalDate, to: addDays(nominalDate, 1) })
      const [tx] = await repos.recurringOccurrences.findTransactions([transactionId])
      if (record === undefined || tx === undefined || tx.recurring_occurrence_id !== record.id) throw new NotFoundError('Match')

      const unlinked = [tx.id]
      if (tx.transfer_id !== null) {
        for (const r of await repos.recurringOccurrences.findTransferRows(tx.transfer_id)) {
          if (r.id !== tx.id && r.recurring_occurrence_id === record.id) unlinked.push(r.id)
        }
      }
      await repos.recurringOccurrences.setLink(unlinked, null)
      await repos.recurringOccurrences.deleteIfEmpty(record.id)
      return this.view(repos, userId, row, nominalDate)
    })
  }

  /** The user's today in their time zone. */
  private async today(repos: Repositories, userId: string): Promise<string> {
    const timezone = (await repos.reports.findTimezone(userId)) ?? 'UTC'
    return todayIn(timezone, this.now())
  }

  /** One occurrence's state, against the user's today. */
  private async state(repos: Repositories, userId: string, row: RecurringItemRow, nominalDate: string): Promise<OccurrenceState> {
    return this.stateOn(repos, row, nominalDate, await this.today(repos, userId))
  }

  /** One occurrence's state, against a given today. */
  private async stateOn(repos: Repositories, row: RecurringItemRow, nominalDate: string, today: string): Promise<OccurrenceState> {
    const filter = { itemId: row.id, from: nominalDate, to: addDays(nominalDate, 1) }
    const history: ItemHistory = groupHistories(
      await repos.recurringOccurrences.listRecords(filter),
      await repos.recurringOccurrences.listLinks(filter),
      await repos.recurringOccurrences.trackingStarts(),
    )(row.id)
    return describeOccurrence(row, history, nominalDate, today)
  }

  /** One occurrence's view, listed on its expected date. */
  private async view(repos: Repositories, userId: string, row: RecurringItemRow, nominalDate: string): Promise<OccurrenceView> {
    const state = await this.state(repos, userId, row, nominalDate)
    return toOccurrenceView(row, state, state.expectedDate)
  }
}

/**
 * Loads an item and checks the date is one of its occurrences.
 *
 * @throws {NotFoundError} If the item does not exist, or the schedule has no occurrence on that date.
 */
async function findOccurrence(repos: Repositories, itemId: string, nominalDate: string): Promise<RecurringItemRow> {
  const row = await repos.recurringItems.find(itemId)
  if (row === undefined) throw new NotFoundError('Recurring item')
  if (occurrences(toSchedule(row), nominalDate, addDays(nominalDate, 1)).length === 0) throw new NotFoundError('Occurrence')
  return row
}

/**
 * Checks an override against its item and returns the amounts to store:
 * only those that differ from the item's.
 *
 * - A skipped occurrence is not also moved.
 * - A move stays within {@link MAX_MOVE_DAYS} of the nominal date.
 * - Amounts are on accounts the item has legs on, one each, non-zero, in
 *   the leg's direction; a transfer or debt payment still nets to zero.
 *
 * @throws {ValidationError} Naming the first rule broken.
 */
function checkOverride(
  row: RecurringItemRow,
  nominalDate: string,
  input: OccurrenceOverrideInput,
): { accountId: string; amount: string }[] {
  if (input.skipped && input.expectedDate !== null && input.expectedDate !== nominalDate) {
    throw new ValidationError('expectedDate: A skipped occurrence is not expected on any date. Send null.')
  }
  if (input.expectedDate !== null
    && (input.expectedDate < addDays(nominalDate, -MAX_MOVE_DAYS) || input.expectedDate > addDays(nominalDate, MAX_MOVE_DAYS))) {
    throw new ValidationError(`expectedDate: An occurrence can move at most ${MAX_MOVE_DAYS} days from ${nominalDate}.`)
  }

  const given = new Map<string, string>()
  for (const leg of input.legs ?? []) {
    const itemLeg = row.legs.find((l) => l.account_id === leg.accountId)
    if (itemLeg === undefined) throw new ValidationError('legs: Each amount must be on an account this item uses.')
    if (given.has(leg.accountId)) throw new ValidationError('legs: One amount per account.')
    const amount = money(leg.amount)
    if (amount.isZero()) throw new ValidationError('legs: An amount cannot be zero. Skip the occurrence instead.')
    if (amount.isNegative() !== money(itemLeg.amount).isNegative()) {
      throw new ValidationError(
        `legs: The amount on this account must ${money(itemLeg.amount).isNegative() ? 'leave it (negative)' : 'arrive (positive)'}, as the item's does.`,
      )
    }
    given.set(leg.accountId, leg.amount)
  }
  if (input.skipped && given.size > 0) throw new ValidationError('legs: A skipped occurrence has no amounts. Send null.')

  if (row.kind === 'transfer' || row.kind === 'debt_payment') {
    const net = addMoney('0', ...row.legs.map((l) => given.get(l.account_id) ?? l.amount))
    if (!money(net).isZero()) {
      throw new ValidationError('legs: The two sides of a transfer must still net to zero. Change both amounts.')
    }
  }
  return row.legs
    .filter((l) => given.has(l.account_id) && !money(given.get(l.account_id) as string).equals(money(l.amount)))
    .map((l) => ({ accountId: l.account_id, amount: given.get(l.account_id) as string }))
}

/** @throws {ValidationError} If the transaction goes the other way from the leg. */
function checkDirection(legAmount: string, tx: CandidateTransactionRow): void {
  const out = money(legAmount).isNegative()
  if (money(tx.amount).isNegative() !== out || money(tx.amount).isZero()) {
    throw new ValidationError(
      `transactionId: This leg is money ${out ? 'leaving' : 'arriving in'} the account, ` +
        `and that transaction is money ${out ? 'arriving' : 'leaving'}.`,
    )
  }
}
