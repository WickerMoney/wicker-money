import type { Query } from '@wickermoney/plugin-sdk/server'
import type { ExportedLumpSum } from './ExportedLumpSum.js'
import type { LumpSumRepository } from './LumpSumRepository.js'
import type { LumpSumRow } from './LumpSumRow.js'
import type { NewLumpSum } from './NewLumpSum.js'

/**
 * {@link LumpSumRepository} over a user-bound query runner.
 *
 * Money is selected as `::text` so PostgreSQL's exact decimal reaches
 * TypeScript as a string, never a `number`; writes cast the incoming string
 * with `::numeric`. A lump sum and its allocations are read in one statement
 * (the allocations aggregated into a JSON array), so a plan costs one read for
 * all of them however many there are.
 */
export class QueryLumpSumRepository implements LumpSumRepository {
  /** @param q - A query runner already bound to the current user. */
  constructor(private readonly q: Query) {}

  /** @inheritdoc */
  list(): Promise<LumpSumRow[]> {
    return this.q<LumpSumRow>`
      SELECT l.id, l.on_date::text AS on_date, l.amount::text AS amount, l.note,
             COALESCE((
               SELECT json_agg(json_build_object('debt_id', a.debt_id, 'amount', a.amount::text) ORDER BY a.debt_id)
               FROM plugin_debt_payoff.lump_sum_allocations a WHERE a.lump_sum_id = l.id
             ), '[]'::json) AS allocations
      FROM plugin_debt_payoff.lump_sums l
      ORDER BY l.on_date, l.created_at, l.id
    `
  }

  /** @inheritdoc */
  async find(id: string): Promise<LumpSumRow | undefined> {
    const rows = await this.q<LumpSumRow>`
      SELECT l.id, l.on_date::text AS on_date, l.amount::text AS amount, l.note,
             COALESCE((
               SELECT json_agg(json_build_object('debt_id', a.debt_id, 'amount', a.amount::text) ORDER BY a.debt_id)
               FROM plugin_debt_payoff.lump_sum_allocations a WHERE a.lump_sum_id = l.id
             ), '[]'::json) AS allocations
      FROM plugin_debt_payoff.lump_sums l
      WHERE l.id = ${id}::uuid
    `
    return rows[0]
  }

  /** @inheritdoc */
  async count(): Promise<number> {
    const rows = await this.q<{ n: number }>`SELECT count(*)::int AS n FROM plugin_debt_payoff.lump_sums`
    return rows[0]?.n ?? 0
  }

  /** @inheritdoc */
  async insert(lumpSum: NewLumpSum): Promise<LumpSumRow> {
    const rows = await this.q<{ id: string }>`
      INSERT INTO plugin_debt_payoff.lump_sums (user_id, on_date, amount, note)
      VALUES (core.current_user_id(), ${lumpSum.onDate}::date, ${lumpSum.amount}::numeric, ${lumpSum.note})
      RETURNING id
    `
    const id = rows[0]?.id
    if (id === undefined) throw new Error('The lump sum was not saved.')
    await this.writeAllocations(id, lumpSum)
    const saved = await this.find(id)
    if (saved === undefined) throw new Error('The lump sum was not saved.')
    return saved
  }

  /** @inheritdoc */
  async replace(id: string, lumpSum: NewLumpSum): Promise<LumpSumRow | undefined> {
    const rows = await this.q<{ id: string }>`
      UPDATE plugin_debt_payoff.lump_sums
      SET on_date = ${lumpSum.onDate}::date, amount = ${lumpSum.amount}::numeric, note = ${lumpSum.note}, updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING id
    `
    if (rows[0] === undefined) return undefined
    await this.q`DELETE FROM plugin_debt_payoff.lump_sum_allocations WHERE lump_sum_id = ${id}::uuid`
    await this.writeAllocations(id, lumpSum)
    return this.find(id)
  }

  /** @inheritdoc */
  async delete(id: string): Promise<number> {
    const gone = await this.q<{ id: string }>`
      DELETE FROM plugin_debt_payoff.lump_sums WHERE id = ${id}::uuid RETURNING id
    `
    return gone.length
  }

  /** @inheritdoc */
  listAll(): Promise<ExportedLumpSum[]> {
    return this.q<ExportedLumpSum>`
      SELECT l.id, l.on_date::text AS on_date, l.amount::text AS amount, l.note,
             COALESCE((
               SELECT json_agg(json_build_object('debt_id', a.debt_id, 'amount', a.amount::text) ORDER BY a.debt_id)
               FROM plugin_debt_payoff.lump_sum_allocations a WHERE a.lump_sum_id = l.id
             ), '[]'::json) AS allocations,
             l.created_at, l.updated_at
      FROM plugin_debt_payoff.lump_sums l
      ORDER BY l.on_date, l.created_at, l.id
    `
  }

  /** Writes a lump sum's parts in one statement, however many there are. */
  private async writeAllocations(id: string, lumpSum: NewLumpSum): Promise<void> {
    if (lumpSum.allocations.length === 0) return
    await this.q`
      INSERT INTO plugin_debt_payoff.lump_sum_allocations (lump_sum_id, user_id, debt_id, amount)
      SELECT ${id}::uuid, core.current_user_id(), p.debt_id, p.amount::numeric
      FROM unnest(${lumpSum.allocations.map((a) => a.debtId)}::uuid[], ${lumpSum.allocations.map((a) => a.amount)}::text[])
        AS p(debt_id, amount)
    `
  }
}
