import type { ColumnType, Generated } from 'kysely'
import type { TimestampWithDefault, Timestamp } from './columns.js'

/** What a snapshot holds: one ordinary transaction, or both legs of a transfer. */
export type UndoSnapshotKind = 'transaction' | 'transfer'

/**
 * A short-lived copy of what deleting a transaction removed, so one request can
 * put it back (ADR 0016).
 *
 * `payload` is `{ transactions, splits, dismissals }`, each an array of
 * `to_jsonb(row)`. It is written and read back in SQL only and never selected
 * into Node, because an amount parsed from it would be a JavaScript number.
 * After a restore it is replaced with `'{}'`.
 */
export interface TransactionUndoSnapshotsTable {
  id: Generated<string>
  user_id: string
  kind: UndoSnapshotKind
  /** Write-only from Node: built and restored inside SQL statements. */
  payload: ColumnType<never, string, string>
  transaction_count: number
  created_at: TimestampWithDefault
  expires_at: Timestamp
  restored_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
}
