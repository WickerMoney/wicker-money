import type { Situation } from '../catalog.js'

/** Outcome of creating the starter category set. */
export interface StarterResult {
  /** Categories newly inserted. */
  readonly created: number
  /** Catalog entries not inserted because the user already had that slug. */
  readonly skipped: number
  /** The situations the selection was based on, echoed back. */
  readonly situations: readonly Situation[]
}
