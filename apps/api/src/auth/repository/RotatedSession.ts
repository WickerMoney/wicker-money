import type { UserIdentity } from './UserIdentity.js'

/** The outcome of a successful refresh-token rotation. */
export interface RotatedSession {
  /** Id of the session that was revoked by the rotation. */
  readonly sessionId: string
  /** Rotation chain both the revoked session and its successor belong to. */
  readonly familyId: string
  /** The session's owner. */
  readonly user: UserIdentity
}
