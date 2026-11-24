import type { LumpSumInput } from '../../shared/index.js'
import type { LumpSumRow } from '../repository/LumpSumRow.js'
import type { LumpSum } from './LumpSum.js'

/**
 * Maps a stored lump sum to the shape the API returns.
 *
 * @param row - A lump sum row.
 * @returns The same lump sum with camel-cased names.
 */
export function toLumpSum(row: LumpSumRow): LumpSum {
  return {
    id: row.id,
    onDate: row.on_date,
    amount: row.amount,
    note: row.note,
    allocations: row.allocations.map((a) => ({ debtId: a.debt_id, amount: a.amount })),
  }
}

/** A stored lump sum as the strategy engine's input. */
export function toLumpSumInput(row: LumpSumRow): LumpSumInput {
  return {
    id: row.id,
    onDate: row.on_date,
    amount: row.amount,
    allocations: row.allocations.map((a) => ({ debtId: a.debt_id, amount: a.amount })),
  }
}
