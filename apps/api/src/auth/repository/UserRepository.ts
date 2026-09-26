import type { LoginCandidate } from './LoginCandidate.js'
import type { UserIdentity } from './UserIdentity.js'

/**
 * Persistence operations for user accounts.
 *
 * Creating an account and finding one by email happen before any user is
 * authenticated, so those two go through purpose-built database functions and
 * work in a system unit of work. The rest need a user context.
 */
export interface UserRepository {
  /**
   * Creates an account. Works with no user context.
   *
   * @param email - Email address; the database trims and lower-cases it.
   * @param passwordHash - Argon2 digest of the password.
   * @returns The new account's identity.
   * @throws {DuplicateKeyError} When the email is already registered.
   */
  register(email: string, passwordHash: string): Promise<UserIdentity>

  /**
   * Looks an account up by email. Works with no user context.
   *
   * @param email - Email address; matched case-insensitively after trimming.
   * @returns The account and its password digest, or `undefined` if none matches.
   */
  findForLogin(email: string): Promise<LoginCandidate | undefined>

  /**
   * @param userId - The current user.
   * @returns The stored password digest, or `undefined` if the account does not exist.
   */
  findPasswordHash(userId: string): Promise<string | undefined>

  /**
   * Replaces the password digest and stamps `updated_at`.
   *
   * @param userId - The current user.
   * @param passwordHash - Argon2 digest of the new password.
   */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>
}
