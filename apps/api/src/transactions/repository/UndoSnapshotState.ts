import type { UndoSnapshotKind } from '../../db/models/index.js'

/** What a restore needs to know about a locked snapshot before it changes anything. */
export interface UndoSnapshotState {
  /** The snapshot id. */
  readonly id: string
  /** Whether it holds one transaction or both legs of a transfer. */
  readonly kind: UndoSnapshotKind
  /** Whether it has already been restored. */
  readonly restored: boolean
  /** Whether its expiry has passed (by the database clock). */
  readonly expired: boolean
}
