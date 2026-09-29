import { sql } from 'kysely'
import type { Trx } from '../../db/Trx.js'
import { databaseNow } from '../../accounts/repository/databaseNow.js'
import type { LegAccount } from './LegAccount.js'
import type { RecurringItemRepository } from './RecurringItemRepository.js'
import type { RecurringItemRow, RecurringLegRow } from './RecurringItemRow.js'
import type { RecurringItemWrite } from './RecurringItemWrite.js'

/** Item columns every read selects. */
const ITEM_COLUMNS = [
  'id', 'name', 'kind', 'frequency', 'series_start_date', 'end_date',
  'semimonthly_day_1', 'semimonthly_day_2', 'category_id', 'created_at', 'updated_at',
] as const

/** Kysely implementation of {@link RecurringItemRepository} over a single transaction. */
export class KyselyRecurringItemRepository implements RecurringItemRepository {
  /** @param trx - The transaction all queries run on. */
  constructor(protected readonly trx: Trx) {}

  /** @inheritdoc */
  async list(): Promise<RecurringItemRow[]> {
    const items = await this.trx
      .selectFrom('core.recurring_items')
      .select(ITEM_COLUMNS)
      .orderBy('name')
      .orderBy('id')
      .execute()
    return this.withLegs(items)
  }

  /** @inheritdoc */
  async find(id: string): Promise<RecurringItemRow | undefined> {
    const items = await this.trx
      .selectFrom('core.recurring_items')
      .select(ITEM_COLUMNS)
      .where('id', '=', id)
      .execute()
    return (await this.withLegs(items))[0]
  }

  /** @inheritdoc */
  async insert(userId: string, item: RecurringItemWrite): Promise<string> {
    const inserted = await this.trx
      .insertInto('core.recurring_items')
      .values({ user_id: userId, ...columns(item) })
      .returning('id')
      .executeTakeFirstOrThrow()
    await this.insertLegs(userId, inserted.id, item)
    return inserted.id
  }

  /** @inheritdoc */
  async replace(userId: string, id: string, item: RecurringItemWrite): Promise<boolean> {
    const updated = await this.trx
      .updateTable('core.recurring_items')
      .set({ ...columns(item), updated_at: databaseNow })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst()
    if (updated === undefined) return false
    // Replace rather than diff: legs have no identity of their own that anything
    // references (plugins key on the item), and the deferred trigger checks the
    // final set at commit, so the empty moment in between is invisible.
    await this.trx.deleteFrom('core.recurring_item_legs').where('recurring_item_id', '=', id).execute()
    await this.insertLegs(userId, id, item)
    return true
  }

  /** @inheritdoc */
  async setEndDate(id: string, endDate: string): Promise<boolean> {
    const updated = await this.trx
      .updateTable('core.recurring_items')
      .set({ end_date: endDate, updated_at: databaseNow })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst()
    return updated !== undefined
  }

  /** @inheritdoc */
  async delete(id: string): Promise<boolean> {
    const gone = await this.trx.deleteFrom('core.recurring_items').where('id', '=', id).returning('id').executeTakeFirst()
    return gone !== undefined
  }

  /** @inheritdoc */
  async findAccounts(ids: readonly string[]): Promise<LegAccount[]> {
    if (ids.length === 0) return []
    return this.trx
      .selectFrom('core.accounts')
      .select(['id', 'account_type', sql<boolean>`archived_at IS NOT NULL`.as('archived')])
      .where('id', 'in', [...ids])
      .execute()
  }

  /** @inheritdoc */
  async findCategoryIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set()
    const rows = await this.trx.selectFrom('core.categories').select('id').where('id', 'in', [...ids]).execute()
    return new Set(rows.map((row) => row.id))
  }

  /** Inserts an item's legs. */
  private async insertLegs(userId: string, itemId: string, item: RecurringItemWrite): Promise<void> {
    if (item.legs.length === 0) return
    await this.trx
      .insertInto('core.recurring_item_legs')
      .values(item.legs.map((leg) => ({
        user_id: userId, recurring_item_id: itemId, account_id: leg.accountId, amount: leg.amount,
      })))
      .execute()
  }

  /** Attaches each item's legs, in one query for the whole set. */
  private async withLegs<T extends { id: string }>(items: readonly T[]): Promise<(T & { legs: RecurringLegRow[] })[]> {
    if (items.length === 0) return []
    const legs = await this.trx
      .selectFrom('core.recurring_item_legs')
      .select(['recurring_item_id', 'account_id', 'amount'])
      .where('recurring_item_id', 'in', items.map((i) => i.id))
      .orderBy('amount')
      .orderBy('account_id')
      .execute()
    const byItem = new Map<string, RecurringLegRow[]>()
    for (const leg of legs) {
      const list = byItem.get(leg.recurring_item_id) ?? []
      list.push({ account_id: leg.account_id, amount: leg.amount })
      byItem.set(leg.recurring_item_id, list)
    }
    return items.map((item) => ({ ...item, legs: byItem.get(item.id) ?? [] }))
  }
}

/** Maps the write shape onto item columns. */
function columns(item: RecurringItemWrite) {
  return {
    name: item.name,
    kind: item.kind,
    frequency: item.frequency,
    series_start_date: item.seriesStartDate,
    end_date: item.endDate,
    semimonthly_day_1: item.semimonthlyDays?.[0] ?? null,
    semimonthly_day_2: item.semimonthlyDays?.[1] ?? null,
    category_id: item.categoryId,
  }
}
