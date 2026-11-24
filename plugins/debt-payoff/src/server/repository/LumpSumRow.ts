/** The part of a lump sum aimed at one debt, as stored. */
export interface LumpSumAllocationRow {
  debt_id: string
  /** Read as text so it never passes through a JavaScript number. */
  amount: string
}

/** A lump sum as stored, with its allocations. Numeric columns are read as text. */
export interface LumpSumRow {
  id: string
  /** `YYYY-MM-DD`. */
  on_date: string
  amount: string
  note: string
  /** The parts aimed at a debt, in debt id order; empty when the whole amount follows the strategy. */
  allocations: LumpSumAllocationRow[]
}
