/** A lump sum as the data export writes it, timestamps included. */
export interface ExportedLumpSum {
  id: string
  on_date: string
  amount: string
  note: string
  /** The parts aimed at a debt; empty when the whole amount follows the strategy. */
  allocations: { debt_id: string; amount: string }[]
  created_at: Date
  updated_at: Date
}
