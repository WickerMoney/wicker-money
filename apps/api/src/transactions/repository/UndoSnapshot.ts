import type { UndoSnapshotKind } from '../../db/models/index.js'

/** A snapshot just written by a delete: what the client needs to offer Undo. */
export interface UndoSnapshot {
  /** The snapshot id, which is the capability to restore it. */
  readonly id: string
  /** Whether it holds one transaction or both legs of a transfer. */
  readonly kind: UndoSnapshotKind
  /** When the snapshot stops being restorable. */
  readonly expiresAt: Date
}
