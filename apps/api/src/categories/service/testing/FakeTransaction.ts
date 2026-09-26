import type { CategorySource } from '../../../db/models/index.js'

/** A ledger row in the in-memory category world, reduced to what rules and usage look at. */
export interface FakeTransaction {
  id: string
  userId: string
  merchant: string
  notes: string | null
  /** Signed decimal string. */
  amount: string
  categoryId: string | null
  categorySource: CategorySource | null
  /** Non-null for a transfer leg; rules never touch those. */
  transferId: string | null
}
