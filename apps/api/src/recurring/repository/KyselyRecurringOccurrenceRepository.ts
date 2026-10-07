import { sql, type ExpressionBuilder } from 'kysely'
import type { Trx } from '../../db/Trx.js'
import type { Database } from '../../db/models/index.js'
import { databaseNow } from '../../accounts/repository/databaseNow.js'
import type { CandidateTransactionRow } from './CandidateTransactionRow.js'
import type { DismissalRow } from './DismissalRow.js'
import type { OccurrenceLinkRow } from './OccurrenceLinkRow.js'
import type { OccurrenceRecordRow } from './OccurrenceRecordRow.js'
import type { DismissalFilter, OccurrenceFilter, RecurringOccurrenceRepository } from './RecurringOccurrenceRepository.js'

/**
 * The most candidates one matching query returns for one account. Per account,
 * so a busy account cannot crowd out a quiet one; a few weeks of one account's
 * transactions is far below it.
 */
export const MAX_CANDIDATES_PER_ACCOUNT = 500

/** Transaction columns matching reads. */
const CANDIDATE_COLUMNS = [
  'id', 'account_id', 'amount', 'transaction_date', 'merchant', 'transfer_id', 'recurring_occurrence_id',
] as const

/** Kysely implementation of {@link RecurringOccurrenceRepository} over a single transaction. */
export class KyselyRecurringOccurrenceRepository implements RecurringOccurrenceRepository {
  /**
   * @param trx - The transaction all queries run on.
   * @param maxCandidatesPerAccount - The cap {@link findCandidates} applies to each account; a test seam.
   */
  constructor(
    protected readonly trx: Trx,
    private readonly maxCandidatesPerAccount: number = MAX_CANDIDATES_PER_ACCOUNT,
  ) {}

  /** @inheritdoc */
  async listRecords(filter: OccurrenceFilter): Promise<OccurrenceRecordRow[]> {
    const records = await this.trx
      .selectFrom('core.recurring_occurrences as o')
      .select(['o.id', 'o.recurring_item_id', 'o.nominal_date', 'o.skipped', 'o.expected_date'])
      .where((eb) => matches(eb, filter))
      .orderBy('o.recurring_item_id')
      .orderBy('o.nominal_date')
      .execute()
    if (records.length === 0) return []
    const legs = await this.trx
      .selectFrom('core.recurring_occurrence_legs')
      .select(['recurring_occurrence_id', 'account_id', 'amount'])
      .where('recurring_occurrence_id', 'in', records.map((r) => r.id))
      .orderBy('account_id')
      .execute()
    const byOccurrence = new Map<string, { account_id: string; amount: string }[]>()
    for (const leg of legs) {
      const list = byOccurrence.get(leg.recurring_occurrence_id) ?? []
      list.push({ account_id: leg.account_id, amount: leg.amount })
      byOccurrence.set(leg.recurring_occurrence_id, list)
    }
    return records.map((r) => ({ ...r, legs: byOccurrence.get(r.id) ?? [] }))
  }

  /** @inheritdoc */
  listLinks(filter: OccurrenceFilter): Promise<OccurrenceLinkRow[]> {
    return this.trx
      .selectFrom('core.recurring_occurrences as o')
      .innerJoin('core.transactions as t', 't.recurring_occurrence_id', 'o.id')
      .select([
        'o.recurring_item_id', 'o.nominal_date', 't.id as transaction_id', 't.account_id', 't.amount',
        't.transaction_date', 't.merchant',
      ])
      .where((eb) => matches(eb, filter))
      .orderBy('o.recurring_item_id')
      .orderBy('o.nominal_date')
      .orderBy('t.account_id')
      .orderBy('t.id')
      .execute()
  }

  /** @inheritdoc */
  async trackingStarts(): Promise<Map<string, string>> {
    const rows = await this.trx
      .selectFrom('core.recurring_occurrences as o')
      .select(['o.recurring_item_id', (eb) => eb.fn.min('o.nominal_date').as('since')])
      .where((eb) => eb.exists(
        eb.selectFrom('core.transactions as t').select('t.id').whereRef('t.recurring_occurrence_id', '=', 'o.id'),
      ))
      .groupBy('o.recurring_item_id')
      .execute()
    return new Map(rows.map((r) => [r.recurring_item_id, String(r.since)]))
  }

  /** @inheritdoc */
  async ensure(userId: string, itemId: string, nominalDate: string): Promise<string> {
    // DO UPDATE rather than DO NOTHING so RETURNING always yields the row,
    // whether it was just made or already there.
    const row = await this.trx
      .insertInto('core.recurring_occurrences')
      .values({ user_id: userId, recurring_item_id: itemId, nominal_date: nominalDate })
      .onConflict((oc) => oc.columns(['recurring_item_id', 'nominal_date']).doUpdateSet({ updated_at: databaseNow }))
      .returning('id')
      .executeTakeFirstOrThrow()
    return row.id
  }

  /** @inheritdoc */
  async write(
    userId: string,
    occurrenceId: string,
    record: {
      readonly skipped: boolean
      readonly expectedDate: string | null
      readonly legs: readonly { readonly accountId: string; readonly amount: string }[]
    },
  ): Promise<void> {
    await this.trx
      .updateTable('core.recurring_occurrences')
      .set({ skipped: record.skipped, expected_date: record.expectedDate, updated_at: databaseNow })
      .where('id', '=', occurrenceId)
      .execute()
    await this.trx.deleteFrom('core.recurring_occurrence_legs').where('recurring_occurrence_id', '=', occurrenceId).execute()
    if (record.legs.length === 0) return
    await this.trx
      .insertInto('core.recurring_occurrence_legs')
      .values(record.legs.map((leg) => ({
        user_id: userId, recurring_occurrence_id: occurrenceId, account_id: leg.accountId, amount: leg.amount,
      })))
      .execute()
  }

  /** @inheritdoc */
  async deleteIfEmpty(occurrenceId: string): Promise<void> {
    await this.trx
      .deleteFrom('core.recurring_occurrences as o')
      .where('o.id', '=', occurrenceId)
      .where('o.skipped', '=', false)
      .where('o.expected_date', 'is', null)
      .where((eb) => eb.not(eb.exists(
        eb.selectFrom('core.recurring_occurrence_legs as l').select('l.id').whereRef('l.recurring_occurrence_id', '=', 'o.id'),
      )))
      .where((eb) => eb.not(eb.exists(
        eb.selectFrom('core.transactions as t').select('t.id').whereRef('t.recurring_occurrence_id', '=', 'o.id'),
      )))
      .execute()
  }

  /** @inheritdoc */
  async pruneAmounts(itemId: string): Promise<number> {
    const result = await sql`
      DELETE FROM core.recurring_occurrence_legs ol
       USING core.recurring_occurrences o
       WHERE o.id = ol.recurring_occurrence_id
         AND o.recurring_item_id = ${itemId}
         AND NOT EXISTS (
           SELECT 1 FROM core.recurring_item_legs il
            WHERE il.recurring_item_id = o.recurring_item_id
              AND il.account_id = ol.account_id
              AND sign(il.amount) = sign(ol.amount)
         )
    `.execute(this.trx)
    return Number(result.numAffectedRows ?? 0n)
  }

  /** @inheritdoc */
  async findTransactions(ids: readonly string[]): Promise<CandidateTransactionRow[]> {
    if (ids.length === 0) return []
    return this.trx.selectFrom('core.transactions').select(CANDIDATE_COLUMNS).where('id', 'in', [...ids]).execute()
  }

  /** @inheritdoc */
  findTransferRows(transferId: string): Promise<CandidateTransactionRow[]> {
    return this.trx.selectFrom('core.transactions').select(CANDIDATE_COLUMNS).where('transfer_id', '=', transferId).execute()
  }

  /** @inheritdoc */
  async findCandidates(accountIds: readonly string[], from: string, through: string): Promise<CandidateTransactionRow[]> {
    const found: CandidateTransactionRow[] = []
    // One query per account (there are few, and they share one connection
    // anyway), newest first, so a cap drops the oldest rows rather than the
    // ones about to be settled. Linked transactions are never candidates.
    for (const accountId of new Set(accountIds)) {
      found.push(...await this.trx
        .selectFrom('core.transactions')
        .select(CANDIDATE_COLUMNS)
        .where('account_id', '=', accountId)
        .where('recurring_occurrence_id', 'is', null)
        .where('transaction_date', '>=', from)
        .where('transaction_date', '<=', through)
        .orderBy('transaction_date', 'desc')
        .orderBy('id', 'desc')
        .limit(this.maxCandidatesPerAccount)
        .execute())
    }
    return found.sort((a, b) => compare(a.transaction_date, b.transaction_date) || compare(a.id, b.id))
  }

  /** @inheritdoc */
  async setLink(transactionIds: readonly string[], occurrenceId: string | null): Promise<void> {
    if (transactionIds.length === 0) return
    await this.trx
      .updateTable('core.transactions')
      .set({ recurring_occurrence_id: occurrenceId, updated_at: databaseNow })
      .where('id', 'in', [...transactionIds])
      .execute()
  }

  /** @inheritdoc */
  async findRecordsById(ids: readonly string[]): Promise<{ id: string; recurring_item_id: string; nominal_date: string }[]> {
    if (ids.length === 0) return []
    return this.trx
      .selectFrom('core.recurring_occurrences')
      .select(['id', 'recurring_item_id', 'nominal_date'])
      .where('id', 'in', [...ids])
      .execute()
  }

  /** @inheritdoc */
  async listDismissals(filter: DismissalFilter): Promise<DismissalRow[]> {
    if (filter.transactionIds !== undefined && filter.transactionIds.length === 0) return []
    let query = this.trx
      .selectFrom('core.recurring_match_dismissals')
      .select(['transaction_id', 'recurring_item_id', 'nominal_date'])
    if (filter.transactionIds !== undefined) query = query.where('transaction_id', 'in', [...filter.transactionIds])
    if (filter.itemId !== undefined) query = query.where('recurring_item_id', '=', filter.itemId)
    if (filter.from !== undefined) query = query.where('nominal_date', '>=', filter.from)
    if (filter.to !== undefined) query = query.where('nominal_date', '<', filter.to)
    return query.orderBy('recurring_item_id').orderBy('nominal_date').orderBy('transaction_id').execute()
  }

  /** @inheritdoc */
  async addDismissal(userId: string, transactionId: string, itemId: string, nominalDate: string): Promise<void> {
    await this.trx
      .insertInto('core.recurring_match_dismissals')
      .values({ user_id: userId, transaction_id: transactionId, recurring_item_id: itemId, nominal_date: nominalDate })
      .onConflict((oc) => oc.columns(['transaction_id', 'recurring_item_id', 'nominal_date']).doNothing())
      .execute()
  }

  /** @inheritdoc */
  async removeDismissals(transactionIds: readonly string[], itemId: string, nominalDate: string): Promise<number> {
    if (transactionIds.length === 0) return 0
    const result = await this.trx
      .deleteFrom('core.recurring_match_dismissals')
      .where('transaction_id', 'in', [...transactionIds])
      .where('recurring_item_id', '=', itemId)
      .where('nominal_date', '=', nominalDate)
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }
}

/** The WHERE clause for an {@link OccurrenceFilter} on `core.recurring_occurrences as o`. */
function matches(eb: ExpressionBuilder<Database & { o: Database['core.recurring_occurrences'] }, 'o'>, filter: OccurrenceFilter) {
  const conditions = []
  if (filter.itemId !== undefined) conditions.push(eb('o.recurring_item_id', '=', filter.itemId))
  if (filter.from !== undefined) conditions.push(eb('o.nominal_date', '>=', filter.from))
  if (filter.to !== undefined) conditions.push(eb('o.nominal_date', '<', filter.to))
  return eb.and(conditions)
}

/** String order. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
