import { addDays } from '@wickermoney/plugin-sdk/date'
import { occurrences } from '@wickermoney/plugin-sdk/recurrence'
import type { Repositories } from '../../data/Repositories.js'
import type { UnitOfWork } from '../../data/UnitOfWork.js'
import { todayIn } from '../../core/service/todayIn.js'
import { ConflictError, NotFoundError, ValidationError } from '../../errors.js'
import { addMoney, money } from '../../money.js'
import type { CandidateTransactionRow } from '../repository/CandidateTransactionRow.js'
import type { RecurringItemRow } from '../repository/RecurringItemRow.js'
import { assignSuggestions } from './assignSuggestions.js'
import { buildDismissed } from './buildDismissed.js'
import { compare } from './compare.js'
import type { Described } from './Described.js'
import { confidentPairs } from './confidentPairs.js'
import { describeAt, wantedRange, type WantedOccurrence } from './describeAt.js'
import { describeRemaining } from './describeRemaining.js'
import type { HistoryRows } from './HistoryRows.js'
import { dismissedPairKeys } from './dismissedPairKeys.js'
import { loadRecurringData } from './loadRecurringData.js'
import { MATCH_WINDOW_DAYS, rankParsedCandidates } from './matchCandidates.js'
import { parseCandidates } from './parseCandidates.js'
import type {
  DismissalView, DismissedSuggestion, MatchSuggestion, MatchSuggestionList, OccurrenceCandidates,
} from './MatchSuggestion.js'
import { MAX_MOVE_DAYS } from './OCCURRENCE_RULES.js'
import type { OccurrenceOverrideInput } from './OccurrenceOverrideInput.js'
import { describeOccurrence, groupHistories, type ItemHistory, type OccurrenceState } from './occurrenceState.js'
import { occurrenceKey } from './occurrenceKey.js'
import type { OccurrenceView } from './OccurrenceView.js'
import { windowOccurrences } from './windowOccurrences.js'
import { rangeCovering, type RecurringData } from './RecurringData.js'
import { suggestionWindow } from './suggestionWindow.js'
import { toOccurrenceView } from './toOccurrenceView.js'
import { toSchedule } from './toSchedule.js'
import type {
  TransactionCandidate, TransactionCandidates, TransactionMatchList, TransactionMatchSummary,
} from './TransactionMatches.js'

/** The most transactions one transaction-matches request may ask about: the largest transaction page. */
export const MAX_TRANSACTION_IDS = 200
/** The most occurrences offered for one transaction. */
const MAX_TRANSACTION_CANDIDATES = 20

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
      const today = await this.today(repos, userId)
      return toView(row, describeFrom(row, nominalDate, today, await this.readHistory(repos, itemId, nominalDate)))
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
      const today = await this.today(repos, userId)
      const before = await this.readHistory(repos, row.id, nominalDate)
      const state = describeFrom(row, nominalDate, today, before)
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
      // Recording an occurrence writes its record and nothing else: the links
      // and tracking starts read above still stand, and today with them.
      const records = await repos.recurringOccurrences.listRecords(historyFilter(row.id, nominalDate))
      return toView(row, describeFrom(row, nominalDate, today, { ...before, records }))
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
      const state = describeFrom(row, nominalDate, today, await this.readHistory(repos, row.id, nominalDate))
      const open = state.legs.filter((l) => l.transaction === null)
      const search = await repos.recurringOccurrences.findCandidates(
        open.map((l) => l.accountId),
        addDays(state.expectedDate, -MATCH_WINDOW_DAYS),
        addDays(state.expectedDate, MATCH_WINDOW_DAYS),
      )
      const dismissed = new Set((await repos.recurringOccurrences.listDismissals(
        { itemId, from: nominalDate, to: addDays(nominalDate, 1) },
      )).map((d) => d.transaction_id))
      const parsed = parseCandidates(search.rows)
      return {
        today,
        occurrence: toOccurrenceView(row, state, state.expectedDate),
        legs: open.map((leg) => ({
          accountId: leg.accountId,
          amount: leg.amount,
          candidates: rankParsedCandidates(leg, state.expectedDate, parsed)
            .map((c) => ({ ...c, dismissed: dismissed.has(c.transactionId) })),
          truncated: search.truncatedAccounts.includes(leg.accountId),
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
   * score first. Skipped occurrences are not considered, and neither is a
   * pair the user dismissed; the same transaction can still be suggested for
   * another occurrence.
   *
   * @param userId - The signed-in user.
   * @returns Suggestions, best first, and the dismissed pairs in the same window.
   */
  suggestions(userId: string): Promise<MatchSuggestionList> {
    return this.uow.forUser(userId, async (repos) => {
      const today = await this.today(repos, userId)
      const data = await loadRecurringData(repos, suggestionWindow(today).scan)
      const { suggestions, dismissed, truncated } = await findSuggestions(repos, data, today, true)
      return { today, suggestions, dismissed, truncated }
    }, { readOnly: true })
  }

  /**
   * Where each of some transactions stands against recurring items: the
   * occurrence it settles, the occurrence suggested for it, and the
   * occurrences it was dismissed for. One request for a whole page of the
   * transaction list.
   *
   * Suggestions are the same ones {@link suggestions} makes, so the
   * Transactions and Recurring pages never disagree.
   *
   * @param userId - The signed-in user.
   * @param transactionIds - At most {@link MAX_TRANSACTION_IDS}.
   * @returns A summary for each transaction that has anything to show.
   */
  forTransactions(userId: string, transactionIds: readonly string[]): Promise<TransactionMatchList> {
    return this.uow.forUser(userId, async (repos) => {
      const today = await this.today(repos, userId)
      const txs = await repos.recurringOccurrences.findTransactions([...new Set(transactionIds)])
      if (txs.length === 0) return { today, transactions: [] }
      const ids = txs.map((t) => t.id)

      const records = await repos.recurringOccurrences.findRecordsById(
        [...new Set(txs.flatMap((t) => (t.recurring_occurrence_id === null ? [] : [t.recurring_occurrence_id])))],
      )
      const recordById = new Map(records.map((r) => [r.id, r]))
      const dismissals = await repos.recurringOccurrences.listDismissals({ transactionIds: ids })
      // Suggestions are for transactions that settle nothing yet; a page of
      // rows that are all linked has none to find, and finding them costs about
      // a dozen queries.
      const wantsSuggestions = txs.some((t) => t.recurring_occurrence_id === null)
      const wanted = [
        ...records.map((r) => ({ itemId: r.recurring_item_id, nominalDate: r.nominal_date })),
        ...dismissals.map((d) => ({ itemId: d.recurring_item_id, nominalDate: d.nominal_date })),
      ]

      // One load serves both readers below, for this request only: it is a
      // local of this callback, built from this transaction's repositories
      // (so under this user's row-level security) and gone when it returns.
      // Nothing in this request writes, so it cannot go stale.
      const range = rangeCovering([
        ...(wanted.length === 0 ? [] : [wantedRange(wanted)]),
        ...(wantsSuggestions ? [suggestionWindow(today).scan] : []),
      ])
      const data = range === null ? undefined : await loadRecurringData(repos, range)

      // The suggestions already describe the occurrences in the window; only
      // the rest of the wanted ones are worked out again.
      const { suggestions, inWindow } = data !== undefined && wantsSuggestions
        ? await findSuggestions(repos, data, today, false)
        : { suggestions: [], inWindow: new Map<string, Described>() }
      const described = data === undefined ? new Map<string, Described>() : describeRemaining(data, today, wanted, inWindow)
      const viewOf = (itemId: string, nominalDate: string): OccurrenceView | null => {
        const found = described.get(occurrenceKey(itemId, nominalDate))
        return found === undefined ? null : toOccurrenceView(found.row, found.state, found.state.expectedDate)
      }

      const suggestionFor = new Map(suggestions.map((s) => [s.candidate.transactionId, s]))

      const transactions: TransactionMatchSummary[] = []
      for (const tx of txs) {
        const record = tx.recurring_occurrence_id === null ? undefined : recordById.get(tx.recurring_occurrence_id)
        const linked = record === undefined ? null : viewOf(record.recurring_item_id, record.nominal_date)
        const dismissed = dismissals
          .filter((d) => d.transaction_id === tx.id)
          .flatMap((d) => viewOf(d.recurring_item_id, d.nominal_date) ?? [])
        const suggestion = suggestionFor.get(tx.id) ?? null
        if (linked === null && suggestion === null && dismissed.length === 0) continue
        transactions.push({ transactionId: tx.id, linked, suggestion, dismissed })
      }
      return { today, transactions }
    }, { readOnly: true })
  }

  /**
   * The occurrences one transaction could settle, best first: those with an
   * unsettled leg on its account, in its direction, expected within the
   * match window of its date. Nothing is linked. A transaction that already
   * settles an occurrence gets that occurrence and no candidates.
   *
   * @param userId - The signed-in user.
   * @param transactionId - The transaction.
   * @returns The occurrence it settles, or its candidates.
   * @throws {NotFoundError} If the transaction does not exist.
   */
  transactionCandidates(userId: string, transactionId: string): Promise<TransactionCandidates> {
    return this.uow.forUser(userId, async (repos) => {
      const today = await this.today(repos, userId)
      const [tx] = await repos.recurringOccurrences.findTransactions([transactionId])
      if (tx === undefined) throw new NotFoundError('Transaction')

      if (tx.recurring_occurrence_id !== null) {
        const [record] = await repos.recurringOccurrences.findRecordsById([tx.recurring_occurrence_id])
        const found = record === undefined
          ? undefined
          : (await describeWanted(repos, today, [{ itemId: record.recurring_item_id, nominalDate: record.nominal_date }]))
            .get(occurrenceKey(record.recurring_item_id, record.nominal_date))
        return {
          today,
          transactionId,
          linked: found === undefined ? null : toOccurrenceView(found.row, found.state, found.state.expectedDate),
          candidates: [],
        }
      }

      // An occurrence can be moved up to a month, so look that much further for nominal dates.
      const reach = MATCH_WINDOW_DAYS + MAX_MOVE_DAYS
      const scan = { from: addDays(tx.transaction_date, -reach), to: addDays(tx.transaction_date, reach + 1) }
      const items = (await repos.recurringItems.list()).filter((r) => r.legs.some((l) => l.account_id === tx.account_id))
      const history = groupHistories(
        await repos.recurringOccurrences.listRecords(scan),
        await repos.recurringOccurrences.listLinks(scan),
        await repos.recurringOccurrences.trackingStarts(),
      )
      const dismissed = new Set((await repos.recurringOccurrences.listDismissals({ transactionIds: [tx.id] }))
        .map((d) => occurrenceKey(d.recurring_item_id, d.nominal_date)))

      const candidates: TransactionCandidate[] = []
      const parsedTx = parseCandidates([tx])
      for (const row of items) {
        const h = history(row.id)
        for (const nominalDate of occurrences(toSchedule(row), scan.from, scan.to)) {
          const state = describeOccurrence(row, h, nominalDate, today)
          if (state.status === 'skipped') continue
          const leg = state.legs.find((l) => l.accountId === tx.account_id)
          if (leg === undefined || leg.transaction !== null) continue
          const [candidate] = rankParsedCandidates(leg, state.expectedDate, parsedTx)
          if (candidate === undefined) continue
          candidates.push({
            occurrence: toOccurrenceView(row, state, state.expectedDate),
            accountId: tx.account_id,
            candidate,
            dismissed: dismissed.has(occurrenceKey(row.id, nominalDate)),
          })
        }
      }
      candidates.sort((a, b) => a.candidate.score - b.candidate.score
        || compare(a.occurrence.expectedDate, b.occurrence.expectedDate) || compare(a.occurrence.name, b.occurrence.name))
      return { today, transactionId, linked: null, candidates: candidates.slice(0, MAX_TRANSACTION_CANDIDATES) }
    }, { readOnly: true })
  }

  /**
   * Dismisses a suggested match: the transaction is not this occurrence,
   * and the pair is never suggested again. The other row of a transfer is
   * dismissed with it when it is on the item's other leg. The transaction
   * can still be suggested for other occurrences, and matched to this one by
   * hand.
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @param transactionId - The transaction.
   * @returns The pairs dismissed.
   * @throws {NotFoundError} If the item, occurrence or transaction does not exist.
   * @throws {ValidationError} If the transaction is on an account the item does not use.
   * @throws {ConflictError} `already_matched` if the transaction settles this very occurrence.
   */
  dismiss(userId: string, itemId: string, nominalDate: string, transactionId: string): Promise<DismissalView> {
    return this.uow.forUser(userId, async (repos) => {
      const row = await findOccurrence(repos, itemId, nominalDate)
      const [tx] = await repos.recurringOccurrences.findTransactions([transactionId])
      if (tx === undefined) throw new NotFoundError('Transaction')
      if (!row.legs.some((l) => l.account_id === tx.account_id)) {
        throw new ValidationError('transactionId: That transaction is on an account this item does not use.')
      }
      if (tx.recurring_occurrence_id !== null) {
        const [record] = await repos.recurringOccurrences.findRecordsById([tx.recurring_occurrence_id])
        if (record?.recurring_item_id === itemId && record.nominal_date === nominalDate) {
          throw new ConflictError('That transaction is matched to this occurrence. Unmatch it instead.', 'already_matched')
        }
      }
      const ids = await withTransferPartner(repos, row, tx)
      for (const id of ids) await repos.recurringOccurrences.addDismissal(userId, id, itemId, nominalDate)
      return { itemId, nominalDate, transactionIds: ids }
    })
  }

  /**
   * Undoes a dismissal, so the pair can be suggested again (with the other
   * row of a transfer, if it was dismissed along with it).
   *
   * @param userId - The signed-in user.
   * @param itemId - The item.
   * @param nominalDate - The occurrence's nominal date.
   * @param transactionId - The transaction.
   * @throws {NotFoundError} If no such dismissal exists for this user.
   */
  undismiss(userId: string, itemId: string, nominalDate: string, transactionId: string): Promise<void> {
    return this.uow.forUser(userId, async (repos) => {
      const [tx] = await repos.recurringOccurrences.findTransactions([transactionId])
      const row = await repos.recurringItems.find(itemId)
      const ids = tx === undefined || row === undefined ? [transactionId] : await withTransferPartner(repos, row, tx)
      const removed = await repos.recurringOccurrences.removeDismissals(ids, itemId, nominalDate)
      if (removed === 0) throw new NotFoundError('Dismissal')
    })
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

      const today = await this.today(repos, userId)
      const before = await this.readHistory(repos, row.id, nominalDate)
      const state = describeFrom(row, nominalDate, today, before)
      if (state.legs.some((l) => l.transaction?.id === tx.id)) return toView(row, state)
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
      // Matching by hand overrides an earlier "not this one".
      await repos.recurringOccurrences.removeDismissals(linked, itemId, nominalDate)
      return toView(row, await this.describeAfterLinking(repos, row, nominalDate, today, before))
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
      const records = await repos.recurringOccurrences.listRecords(historyFilter(itemId, nominalDate))
      const [record] = records
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
      const today = await this.today(repos, userId)
      return toView(row, await this.describeAfterLinking(repos, row, nominalDate, today, { records }))
    })
  }

  /** The user's today in their time zone. */
  private async today(repos: Repositories, userId: string): Promise<string> {
    const timezone = (await repos.reports.findTimezone(userId)) ?? 'UTC'
    return todayIn(timezone, this.now())
  }
  /** What describing one occurrence reads: its records and links, and every item's tracking start. */
  private async readHistory(repos: Repositories, itemId: string, nominalDate: string): Promise<HistoryRows> {
    const filter = historyFilter(itemId, nominalDate)
    return {
      records: await repos.recurringOccurrences.listRecords(filter),
      links: await repos.recurringOccurrences.listLinks(filter),
      trackingStarts: await repos.recurringOccurrences.trackingStarts(),
    }
  }

  /**
   * One occurrence's state after transactions were linked to it or unlinked
   * from it. Linking writes the transaction rows and, at most, an empty
   * record, which describes the same as none, so what was read before about
   * its records (and today) still holds: only the links and the tracking
   * starts, which the link changes, are read again.
   */
  private async describeAfterLinking(
    repos: Repositories,
    row: RecurringItemRow,
    nominalDate: string,
    today: string,
    before: Pick<HistoryRows, 'records'>,
  ): Promise<OccurrenceState> {
    return describeFrom(row, nominalDate, today, {
      records: before.records,
      links: await repos.recurringOccurrences.listLinks(historyFilter(row.id, nominalDate)),
      trackingStarts: await repos.recurringOccurrences.trackingStarts(),
    })
  }
}

/** The rows that describe one occurrence: its item's, on its nominal date. */
function historyFilter(itemId: string, nominalDate: string): { itemId: string; from: string; to: string } {
  return { itemId, from: nominalDate, to: addDays(nominalDate, 1) }
}

/** One occurrence's state from rows already read, against a given today. */
function describeFrom(row: RecurringItemRow, nominalDate: string, today: string, rows: HistoryRows): OccurrenceState {
  const history: ItemHistory = groupHistories(rows.records, rows.links, rows.trackingStarts)(row.id)
  return describeOccurrence(row, history, nominalDate, today)
}

/** One occurrence's view, listed on its expected date. */
function toView(row: RecurringItemRow, state: OccurrenceState): OccurrenceView {
  return toOccurrenceView(row, state, state.expectedDate)
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
  for (const [i, leg] of (input.legs ?? []).entries()) {
    const itemLeg = row.legs.find((l) => l.account_id === leg.accountId)
    if (itemLeg === undefined) {
      throw new ValidationError(`legs.${i}.accountId: Each amount must be on an account this item uses.`)
    }
    if (given.has(leg.accountId)) throw new ValidationError(`legs.${i}.accountId: One amount per account.`)
    const amount = money(leg.amount)
    if (amount.isZero()) {
      throw new ValidationError(`legs.${i}.amount: Must be more than 0. To leave this one out, skip it instead.`)
    }
    if (amount.isNegative() !== money(itemLeg.amount).isNegative()) {
      throw new ValidationError(
        `legs.${i}.amount: The amount on this account must ${money(itemLeg.amount).isNegative() ? 'leave it (negative)' : 'arrive (positive)'}, as the item's does.`,
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

/**
 * Works out the suggestions: see {@link RecurringOccurrenceService.suggestions}.
 *
 * @param repos - Repositories, under the user's row-level security.
 * @param data - The request's loaded data, covering the suggestion window's scan.
 * @param today - The user's today.
 * @param withDismissed - Whether to work out the dismissed pairs too, which costs a read of their
 *   transactions; a caller that wants only the suggestions leaves `dismissed` empty.
 * @returns Suggestions, best first, the dismissed pairs in the window, whether a transaction query
 *   hit its cap, and the occurrences in the window (by {@link occurrenceKey}) as described to find them.
 */
async function findSuggestions(
  repos: Repositories,
  data: RecurringData,
  today: string,
  withDismissed: boolean,
): Promise<{
  suggestions: MatchSuggestion[]
  dismissed: DismissedSuggestion[]
  truncated: boolean
  inWindow: ReadonlyMap<string, Described>
}> {
  const window = suggestionWindow(today)
  const dismissals = await repos.recurringOccurrences.listDismissals(window.scan)
  const { inWindow, open } = windowOccurrences(data, window, today)
  const accounts = [...new Set(open.map((o) => o.accountId))]
  const search = await repos.recurringOccurrences.findCandidates(
    accounts, addDays(window.from, -MATCH_WINDOW_DAYS), addDays(window.to, MATCH_WINDOW_DAYS),
  )
  const suggestions = assignSuggestions(confidentPairs(open, search.rows, dismissedPairKeys(dismissals)))
  const truncated = search.truncatedAccounts.length > 0
  if (!withDismissed) return { suggestions, dismissed: [], truncated, inWindow }

  // Dismissed pairs, to undo: only while the occurrence is in the window and
  // the transaction settles nothing, since otherwise the dismissal changes nothing.
  const relevant = dismissals.filter((d) => inWindow.has(occurrenceKey(d.recurring_item_id, d.nominal_date)))
  const txById = new Map((await repos.recurringOccurrences.findTransactions(
    [...new Set(relevant.map((d) => d.transaction_id))],
  )).map((t) => [t.id, t]))
  const dismissed = buildDismissed(relevant, inWindow, txById)
  return { suggestions, dismissed, truncated, inWindow }
}

/**
 * Loads what some occurrences need and describes them: see {@link describeAt}.
 * Reads nothing when none are wanted.
 */
async function describeWanted(
  repos: Repositories,
  today: string,
  wanted: readonly WantedOccurrence[],
): Promise<Map<string, Described>> {
  if (wanted.length === 0) return new Map()
  return describeAt(await loadRecurringData(repos, wantedRange(wanted)), today, wanted)
}

/**
 * A transaction and, when it is one row of a transfer whose other row is on
 * another of the item's legs, that other row: the two are one movement of
 * money, so matching and dismissing treat them together.
 */
async function withTransferPartner(repos: Repositories, row: RecurringItemRow, tx: CandidateTransactionRow): Promise<string[]> {
  if (tx.transfer_id === null) return [tx.id]
  const partner = (await repos.recurringOccurrences.findTransferRows(tx.transfer_id)).find((r) => r.id !== tx.id)
  if (partner === undefined || partner.account_id === tx.account_id) return [tx.id]
  return row.legs.some((l) => l.account_id === partner.account_id) ? [tx.id, partner.id] : [tx.id]
}
