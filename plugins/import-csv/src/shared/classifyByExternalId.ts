import type { ClassifiedRow } from './ClassifiedRow.js'
import type { ExistingIndex } from './ExistingIndex.js'
import type { MappedRow } from './mapping.js'

/**
 * Classifies a row that carries the source's own transaction id.
 *
 * A match with an existing transaction or an earlier row is a `duplicate`. An
 * id the ledger has never seen is authoritative evidence of a new transaction,
 * so the amount/merchant heuristic is not consulted.
 *
 * @param row - A mapped row whose `externalId` is not `null`.
 * @param existing - Index of the transactions already in the account.
 * @param seenIds - Ids of earlier rows in this file; the row's id is added when it is new.
 * @returns The verdict for the row.
 */
export function classifyByExternalId(
  row: MappedRow,
  existing: ExistingIndex,
  seenIds: Set<string>,
): ClassifiedRow {
  const id = row.externalId as string
  const hit = existing.findByExternalId(id)
  if (hit !== undefined) {
    return { row, status: 'duplicate', matched: hit, reason: `already imported (id ${id})` }
  }
  if (seenIds.has(id)) {
    return { row, status: 'duplicate', matched: null, reason: `repeated id ${id} within this file` }
  }
  seenIds.add(id)
  return { row, status: 'new', matched: null, reason: null }
}
