import type { Transaction } from '../../db/models/index.js'

/** The outcome of recording a transfer. */
export interface TransferCreated {
  /** The id shared by both legs. */
  readonly transferId: string
  /** The outgoing leg followed by the incoming leg. */
  readonly legs: Transaction[]
}
