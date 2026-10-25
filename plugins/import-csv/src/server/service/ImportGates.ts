import type { ImportGate } from './ImportGate.js'

/** The caps the import service applies; a missing one means no cap on that step. */
export interface ImportGates {
  /** Limits concurrent commits. */
  readonly commit?: ImportGate
  /** Limits concurrent analyses. */
  readonly analyze?: ImportGate
}
