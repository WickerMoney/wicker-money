import type { CreatedSession } from './CreatedSession.js'
import type { NewRefreshToken } from './NewRefreshToken.js'
import type { NewSession } from './NewSession.js'
import type { RotatedSession } from './RotatedSession.js'

/**
 * Persistence operations for refresh-token sessions.
 *
 * Sessions form families: every rotation of a refresh token produces a
 * successor row in the same family. Rotating, revoking by token and probing
 * liveness run without a user context (they happen before authentication or
 * while checking it); the remaining operations need a user context.
 */
export interface SessionRepository {
  /**
   * Stores a session for a newly issued refresh token, starting a new family.
   *
   * @param input - The session to create. Needs a user context for that user.
   * @returns The stored session's id and family.
   */
  insert(input: NewSession): Promise<CreatedSession>

  /**
   * Atomically revokes the session holding `tokenHash` if, and only if, it is
   * still active, and stores `next` as its successor in the same family, in
   * one step. Of any number of concurrent callers presenting the same token, at
   * most one receives a result. Works with no user context.
   *
   * @param tokenHash - Digest of the presented refresh token.
   * @param next - The replacement token to store.
   * @returns The rotated session and its owner, or `undefined` if the token is unknown, already revoked or expired (nothing is stored then).
   */
  rotate(tokenHash: string, next: NewRefreshToken): Promise<RotatedSession | undefined>

  /**
   * Revokes every still-active session in the family that `tokenHash` belongs
   * to. Works with no user context.
   *
   * @param tokenHash - Digest of any refresh token in the family, active or not.
   * @returns Whether the token belongs to a known family.
   */
  revokeFamilyOf(tokenHash: string): Promise<boolean>

  /**
   * Revokes every active session the current user has, ending all devices.
   *
   * @param userId - The current user.
   */
  revokeAllForUser(userId: string): Promise<void>

  /**
   * Whether a family still has a session that is neither revoked nor expired.
   * Works with no user context.
   *
   * @param familyId - The `sid` claim of an access token.
   * @returns True if the family is live.
   */
  isFamilyActive(familyId: string): Promise<boolean>

  /**
   * Deletes sessions that expired or were revoked more than `retainSeconds` ago.
   * Works with no user context.
   *
   * @param retainSeconds - How long dead sessions are kept, so that replays of recently rotated tokens are still recognised.
   * @returns The number of rows deleted.
   */
  purgeDead(retainSeconds: number): Promise<number>
}
