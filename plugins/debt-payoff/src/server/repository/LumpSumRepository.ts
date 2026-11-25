import type { ExportedLumpSum } from './ExportedLumpSum.js'
import type { LumpSumRow } from './LumpSumRow.js'
import type { NewLumpSum } from './NewLumpSum.js'

/** The user's lump sums and their allocations. Every method sees only the signed-in user's rows. */
export interface LumpSumRepository {
  /** @returns Every lump sum, soonest date first (then oldest first, then id), each with its allocations, in one read. */
  list(): Promise<LumpSumRow[]>

  /** @returns The lump sum, or `undefined` if the user has none with that id. */
  find(id: string): Promise<LumpSumRow | undefined>

  /** @returns How many lump sums the user has. */
  count(): Promise<number>

  /** @returns The new lump sum with its allocations. */
  insert(lumpSum: NewLumpSum): Promise<LumpSumRow>

  /**
   * Replaces the date, amount, note and allocations of a lump sum.
   *
   * @returns The lump sum as saved, or `undefined` if the user has none with that id.
   */
  replace(id: string, lumpSum: NewLumpSum): Promise<LumpSumRow | undefined>

  /** @returns How many lump sums were deleted: 0 or 1. Its allocations go with it. */
  delete(id: string): Promise<number>

  /** @returns Every lump sum with its allocations and timestamps, for the data export. */
  listAll(): Promise<ExportedLumpSum[]>
}
